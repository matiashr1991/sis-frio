// STA state machine. Only this tab drives connections: auto-reconnect is off and
// the event hook just stores scalars that wifiTick() consumes.
StaState g_sta = STA_IDLE;

static volatile uint8_t evReason = 0;
static volatile bool evGotIp = false;
static uint8_t net = 0;        // network in use / being tried: 0 primary, 1 secondary
static uint32_t tState = 0;    // entry time of the current state
static uint32_t tRetry = 0;    // RECOVERING: time of the last re-begin
static uint32_t tBroker = 0;   // last time the broker was fine (or the link came up)
static uint32_t tProbe = 0;
static uint32_t backoffMs = BACKOFF_MIN_MS;
static bool scanning = false;
static uint8_t hits = 0;
static bool hold = false;      // broker-triggered failover: no primary return until HOLDOFF_MS passed
static uint32_t tHold = 0;

static void onWifiEvent(arduino_event_id_t event, arduino_event_info_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) evGotIp = true;
  else if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) evReason = info.wifi_sta_disconnected.reason;
}

const char* wifiReason(uint8_t code) {
  switch (code) {
    case 201: case 210: case 211: case 212: return "no_ap";  // 2.4 GHz / hidden?
    case 2: case 15: case 202: case 204: return "auth";
    default: return "link";
  }
}

void wifiBegin() {
  WiFi.persistent(false);  // first WiFi call: never write the stack's NVS namespace
  WiFi.onEvent(onWifiEvent);
  WiFi.setAutoReconnect(false);
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_TX_POWER);
}

bool staOnline() { return g_sta == STA_ONLINE; }

void wifiLockForTest() { g_sta = STA_TESTING; }
void wifiLockRelease() { g_sta = STA_IDLE; }  // IDLE restarts at the primary

// Portal WiFi test: the caller holds STA_TESTING; success = GOT_IP within 15 s.
void wifiTestStart(const WifiCred& c, uint32_t now) {
  g_sta = STA_TESTING;
  WiFi.disconnect(false, false);
  evGotIp = false;
  evReason = 0;
  tState = now;
  WiFi.begin(c.ssid, c.pass);
  Serial.printf("WiFi test: ssid len %u, pass len %u\n", (unsigned)strlen(c.ssid), (unsigned)strlen(c.pass));
}

int wifiTestPoll(uint32_t now, const char** reason) {
  if (evGotIp) return 1;
  if (now - tState < CONNECT_TIMEOUT_MS) return 0;
  const uint8_t r = evReason == 8 ? 0 : evReason;  // 8 = our own disconnect()
  *reason = r ? wifiReason(r) : "timeout";
  Serial.printf("WiFi test failed, reason code %u\n", r);
  return -1;
}

static void beginNet(uint8_t n) {
  net = n;
  evGotIp = false;
  evReason = 0;
  WiFi.begin(g_wifi[n].ssid, g_wifi[n].pass);
}

static void connectTo(uint8_t n, uint32_t now) {
  Serial.printf("WiFi: connecting to %s (ssid len %u)\n", n ? "secondary" : "primary", (unsigned)strlen(g_wifi[n].ssid));
  beginNet(n);
  g_sta = STA_CONNECTING;
  tState = now;
}

static void goOnline(uint32_t now) {
  g_sta = STA_ONLINE;
  tBroker = now;
  tProbe = now;
  backoffMs = BACKOFF_MIN_MS;
  scanning = false;
  hits = 0;
  if (net == 0) hold = false;
  apClear(AP_FALLBACK);
  Serial.printf("WiFi: online on %s, IP %s, RSSI %d dBm\n", net ? "secondary" : "primary",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

// After a failed attempt: primary -> secondary (if any) -> backoff -> primary.
static void attemptFailed(uint32_t now) {
  Serial.printf("WiFi: %s failed (%s)\n", net ? "secondary" : "primary", wifiReason(evReason));
  WiFi.disconnect(false, false);
  if (net == 0 && g_hasWifi[1]) {
    connectTo(1, now);
    return;
  }
  g_sta = STA_BACKOFF;
  tState = now;
  Serial.printf("WiFi: backoff %lu s\n", (unsigned long)(backoffMs / 1000));
  apRequest(AP_FALLBACK);  // both networks down: config AP stays open until the STA is back
}

// While on the secondary: light async scan for the primary, return after 2 stable hits.
static void probePrimary(uint32_t now) {
  if (hold) {
    if (now - tHold < HOLDOFF_MS) return;
    hold = false;
  }
  if (scanning) {
    const int n = WiFi.scanComplete();
    if (n == WIFI_SCAN_RUNNING) return;
    scanning = false;
    bool hit = false;
    for (int i = 0; i < n; i++) {
      if (WiFi.SSID(i) == g_wifi[0].ssid && WiFi.RSSI(i) >= RETURN_MIN_RSSI) hit = true;
    }
    WiFi.scanDelete();
    hits = hit ? hits + 1 : 0;
    if (hits >= RETURN_HITS) {
      Serial.println("WiFi: primary stable, returning");
      connectTo(0, now);
    }
  } else if (now - tProbe >= PROBE_MS && !WiFi.softAPgetStationNum()) {  // a scan would drop the phone
    tProbe = now;
    scanning = WiFi.scanNetworks(true) == WIFI_SCAN_RUNNING;
  }
}

void wifiTick(uint32_t now) {
  const uint8_t other = net ? 0 : 1;
  switch (g_sta) {
    case STA_IDLE:  // no primary saved: nothing to do until one is committed
      if (g_hasWifi[0]) connectTo(0, now);
      break;

    case STA_CONNECTING:
      if (evGotIp) goOnline(now);
      else if (now - tState >= CONNECT_TIMEOUT_MS) attemptFailed(now);
      break;

    case STA_ONLINE:
      if (WiFi.status() != WL_CONNECTED) {
        Serial.printf("WiFi: link lost (%s)\n", wifiReason(evReason));
        g_sta = STA_RECOVERING;
        tState = tRetry = now;
        beginNet(net);
        break;
      }
      if (mqttConnected() || !g_hasMqtt) {
        tBroker = now;
      } else if (now - tBroker >= BROKER_DOWN_MS && g_hasWifi[other]) {
        Serial.println("WiFi: broker unreachable, switching network");
        hold = true;
        tHold = now;
        connectTo(other, now);
        break;
      }
      if (net == 1 && g_hasWifi[0]) probePrimary(now);
      break;

    case STA_RECOVERING:  // grace period: re-begin the same network at 0 s and 15 s
      if (evGotIp) goOnline(now);
      else if (now - tState >= LINK_LOSS_MS) {
        hold = false;  // link-loss failover: no hold-off
        connectTo(g_hasWifi[other] ? other : net, now);
      }
      else if (now - tRetry >= CONNECT_TIMEOUT_MS) {
        tRetry = now;
        beginNet(net);
      }
      break;

    case STA_BACKOFF:
      if (WiFi.softAPgetStationNum()) tState = now;  // phone on the AP: pause retries
      else if (now - tState >= backoffMs) {
        backoffMs = min<uint32_t>(backoffMs * 2, BACKOFF_MAX_MS);
        connectTo(0, now);
      }
      break;

    case STA_TESTING:  // the portal test job owns the radio
      break;
  }
}
