// Config portal: WPA2 softAP (device password) + wildcard DNS, no HTTP auth (captive-portal browsers
// cannot answer a Basic prompt; the server only listens while the AP is up), and one background
// test slot (test passes -> step committed to NVS).
#include <WebServer.h>
#include <DNSServer.h>
#include "portal_html.h"

static WebServer server(80);
static DNSServer dns;
static TestJob job;
static uint32_t jobSeq = 0;
static uint8_t apMask = 0;
static bool apUp = false;
static uint8_t closeMask = 0;   // deferred close so the /api/finish reply gets out first
static uint32_t closeAt = 0;

void chipTag(char out[7]) {
  const uint64_t mac = ESP.getEfuseMac();  // byte 0 is the least significant
  snprintf(out, 7, "%02X%02X%02X", (unsigned)(mac >> 24) & 0xFF, (unsigned)(mac >> 32) & 0xFF, (unsigned)(mac >> 40) & 0xFF);
}

static void apStart() {
  char tag[7], ssid[16];
  chipTag(tag);
  snprintf(ssid, sizeof(ssid), "frio-%s", tag);
  WiFi.softAP(ssid, g_devPass, 1, 0, 1);  // WPA2, channel 1, hidden=0, one station; enables WIFI_AP_STA
  WiFi.setTxPower(WIFI_TX_POWER);
  dns.start(53, "*", IPAddress(192, 168, 4, 1));
  server.begin();  // served only while the AP is up
  apUp = true;
  Serial.printf("AP up: %s (mask %u)\n", ssid, apMask);
}

static void apStop() {
  server.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  apUp = false;
  Serial.println("AP closed");
}

void apRequest(uint8_t reason) {
  apMask |= reason;
  if (!apUp) apStart();
}

void apClear(uint8_t reason) {
  apMask &= ~reason;
  if (!apMask && apUp) apStop();
}

static void jstr(String& o, const char* s) {
  o += '"';
  for (; *s; s++) {
    if (*s == '"' || *s == '\\') o += '\\';
    o += (uint8_t)*s < 32 ? '?' : *s;
  }
  o += '"';
}

static void hRoot() {
  server.send_P(200, "text/html", PAGE_HTML);
}

static void hScan() {
  const int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_FAILED) WiFi.scanNetworks(true);
  String o = "{\"state\":\"";
  o += n >= 0 ? "done" : "running";
  o += "\",\"nets\":[";
  for (int i = 0, c = 0; i < n && c < 20; i++) {
    if (!WiFi.SSID(i).length()) continue;
    if (c++) o += ',';
    o += "{\"ssid\":";
    jstr(o, WiFi.SSID(i).c_str());
    o += ",\"rssi\":" + String(WiFi.RSSI(i)) + ",\"ch\":" + String(WiFi.channel(i)) + ",\"open\":" +
         (WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "true}" : "false}");
  }
  if (n >= 0) WiFi.scanDelete();
  server.send(200, "application/json", o + "]}");
}

static void hTest() {
  if (job.state == JOB_RUN) return server.send(409, "application/json", "{\"error\":\"busy\"}");
  const String st = server.arg("step");
  const uint8_t step = st == "w1" ? 0 : st == "w2" ? 1 : st == "mq" ? 2 : 9;
  const String a = server.arg(step == 2 ? "host" : "ssid"), p = server.arg("pass"), u = server.arg("user");
  const long port = server.arg("port").toInt();
  const bool valid = step < 2 ? (a.length() >= 1 && a.length() <= 32 && (!p.length() || (p.length() >= 8 && p.length() <= 63)))
                     : step == 2 ? (a.length() >= 1 && a.length() <= 63 && port >= 1 && port <= 65535 && u.length() <= 64 && p.length() <= 64)
                                 : false;
  if (!valid) return server.send(400, "application/json", "{\"error\":\"invalid\"}");
  const uint32_t now = millis();
  memset(&job, 0, sizeof(job));
  job.id = ++jobSeq;
  job.step = step;
  job.state = JOB_RUN;
  job.t0 = now + 400;  // jobTick starts the test after this 202 reply has reached the phone
  if (step < 2) {
    strlcpy(job.cred.ssid, a.c_str(), sizeof(job.cred.ssid));
    strlcpy(job.cred.pass, p.c_str(), sizeof(job.cred.pass));
  } else {
    strlcpy(job.mq.host, a.c_str(), sizeof(job.mq.host));
    job.mq.port = port;
    strlcpy(job.mq.user, u.c_str(), sizeof(job.mq.user));
    strlcpy(job.mq.pass, p.c_str(), sizeof(job.mq.pass));
  }
  Serial.printf("Test %lu step %u: lens %u/%u/%u\n", (unsigned long)job.id, step, (unsigned)a.length(), (unsigned)p.length(), (unsigned)u.length());
  server.send(202, "application/json", "{\"id\":" + String(job.id) + "}");
}

// Never includes passwords, only saved SSIDs / broker address.
static void hStatus() {
  const bool mine = !server.hasArg("id") || (uint32_t)server.arg("id").toInt() == job.id;
  const uint8_t s = mine ? job.state : (uint8_t)JOB_NONE;
  String o = "{\"id\":" + String(job.id) + ",\"state\":\"";
  o += s == JOB_RUN ? "running" : s == JOB_OK ? "ok" : s == JOB_FAIL ? "fail" : "none";
  o += "\",\"reason\":\"";
  o += job.reason ? job.reason : "";
  o += job.saved ? "\",\"saved\":true,\"w1\":" : "\",\"saved\":false,\"w1\":";
  jstr(o, g_hasWifi[0] ? g_wifi[0].ssid : "");
  o += ",\"w2\":";
  jstr(o, g_hasWifi[1] ? g_wifi[1].ssid : "");
  char mq[80] = "";
  if (g_hasMqtt) snprintf(mq, sizeof(mq), "%s:%u", g_mqtt.host, g_mqtt.port);
  o += ",\"mq\":";
  jstr(o, mq);
  o += g_hasMqtt && g_mqtt.user[0] ? ",\"mqUser\":true}" : ",\"mqUser\":false}";
  server.send(200, "application/json", o);
}

static void hFinish() {
  closeMask = AP_MANUAL | (g_hasWifi[0] ? AP_PROVISION : 0);
  closeAt = millis() + 1500;
  server.send(200, "application/json", "{}");
}

static void hRedirect() {  // captive-portal probes (Android/iOS/Windows) land here
  server.sendHeader("Location", "http://192.168.4.1/");
  server.send(302, "text/plain", "");
}

// Test end: commit only on pass, then wipe the credential copy.
static void jobEnd(bool ok, const char* reason, uint32_t now) {
  if (ok) job.saved = job.step == 2 ? commitMqtt(job.mq) : commitWifi(job.step, job.cred);
  job.reason = ok && !job.saved ? "nvs" : reason;
  job.state = ok && job.saved ? JOB_OK : JOB_FAIL;
  job.t0 = now;  // result retained 10 min from here
  memset(&job.cred, 0, sizeof(job.cred));
  memset(&job.mq, 0, sizeof(job.mq));
  if (job.step < 2) wifiLockRelease();
  Serial.printf("Test %lu %s (%s)\n", (unsigned long)job.id, job.state == JOB_OK ? "ok" : "fail", job.reason);
}

static void jobTick(uint32_t now) {
  if (job.state >= JOB_OK) {
    if (now - job.t0 > 600000) job.state = JOB_NONE;
    return;
  }
  if (job.state != JOB_RUN || (int32_t)(now - job.t0) < 0) return;
  const char* reason = "";
  if (job.step == 2) {
    jobEnd(mqttTest(job.mq, &reason), reason, now);
  } else {
    if (!job.started) {  // WiFi.begin scans and may move the AP channel: only after the reply went out
      job.started = true;
      wifiTestStart(job.cred, now);
      return;
    }
    const int r = wifiTestPoll(now, &reason);
    if (r) jobEnd(r > 0, reason, now);
  }
}

void portalBegin() {
  server.on("/", HTTP_GET, hRoot);
  server.on("/api/scan", HTTP_GET, hScan);
  server.on("/api/test", HTTP_POST, hTest);
  server.on("/api/status", HTTP_GET, hStatus);
  server.on("/api/finish", HTTP_POST, hFinish);
  server.onNotFound(hRedirect);
  if (!g_hasWifi[0]) apRequest(AP_PROVISION);  // blank NVS: config mode only, no STA attempt
}

void portalTick(uint32_t now) {
  if (closeMask && (int32_t)(now - closeAt) >= 0) {
    apClear(closeMask);
    closeMask = 0;
  }
  jobTick(now);
  if (!apUp) return;
  dns.processNextRequest();
  server.handleClient();
}
