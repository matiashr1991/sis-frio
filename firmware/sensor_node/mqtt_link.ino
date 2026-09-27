// Live MQTT session. Topics: frio/<site>/cam<N>/temp (plain float), retained frio/<site>/status + Last Will.
#include <PubSubClient.h>

static WiFiClient liveNet;
static PubSubClient live(liveNet);
static char g_mqHost[64];  // PubSubClient keeps the pointer; only rewritten while disconnected
static uint32_t tAttempt = 0;

bool mqttConnected() { return live.connected(); }

bool mqttPublish(const char* topic, const char* payload) {
  return live.connected() && live.publish(topic, payload);
}

void mqttTick(uint32_t now) {
  if (!g_hasMqtt) return;
  if (!staOnline()) {
    if (liveNet.connected()) liveNet.stop();  // no DISCONNECT: the broker publishes the Last Will
    return;
  }
  if (live.connected()) {
    live.loop();
    return;
  }
  if (now - tAttempt < MQTT_RETRY_MS) return;
  tAttempt = now;

  char statusTopic[48];
  snprintf(statusTopic, sizeof(statusTopic), "frio/%s/status", SITE_ID);
  strlcpy(g_mqHost, g_mqtt.host, sizeof(g_mqHost));
  live.setServer(g_mqHost, g_mqtt.port);
  live.setSocketTimeout(4);
  Serial.printf("MQTT: connecting to %s:%u\n", g_mqHost, g_mqtt.port);
  const bool auth = g_mqtt.user[0];
  if (live.connect(SITE_ID, auth ? g_mqtt.user : nullptr, auth ? g_mqtt.pass : nullptr, statusTopic, 1, true, "offline")) {
    live.publish(statusTopic, "online", true);
    Serial.println("MQTT: connected");
  } else {
    Serial.printf("MQTT: failed, rc=%d\n", live.state());
  }
}

// Portal test: separate client id, no Last Will, so the live session is never kicked.
// Bounded blocking (about 8 s with an IP host, plus DNS).
static WiFiClient testNet;
static PubSubClient testMqtt(testNet);

bool mqttTest(const MqttCfg& c, const char** reason) {
  if (WiFi.status() != WL_CONNECTED) { *reason = "no_wifi"; return false; }
  IPAddress ip;
  if (!WiFi.hostByName(c.host, ip)) { *reason = "dns"; return false; }
  char id[20], tag[7];
  chipTag(tag);
  snprintf(id, sizeof(id), "cfgtest-%s", tag);
  testMqtt.setServer(ip, c.port);
  testMqtt.setSocketTimeout(4);
  const bool auth = c.user[0];
  const uint32_t t0 = millis();
  const bool ok = testMqtt.connect(id, auth ? c.user : nullptr, auth ? c.pass : nullptr);
  const int rc = testMqtt.state();
  const uint32_t dt = millis() - t0;
  if (ok) testMqtt.disconnect();
  testNet.stop();
  Serial.printf("MQTT test: rc=%d in %lu ms\n", rc, (unsigned long)dt);
  switch (rc) {
    case 0:  *reason = "ok"; break;
    case 1:  *reason = "protocol"; break;
    case 2:  *reason = "client_id"; break;
    case 3:  *reason = "unavailable"; break;
    case 4:  *reason = "bad_credentials"; break;
    case 5:  *reason = "not_authorized"; break;
    case -4: *reason = "no_connack"; break;
    default: *reason = dt < 1000 ? "refused" : "unreachable";
  }
  return ok;
}
