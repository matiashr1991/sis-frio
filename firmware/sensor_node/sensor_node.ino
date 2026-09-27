#include <WiFi.h>
#include "app.h"

constexpr uint8_t ONE_WIRE_PIN = 4;
constexpr const char* SITE_ID = "sucursal1";
constexpr uint32_t PUBLISH_INTERVAL_MS = 10000;
constexpr uint32_t CONVERSION_MS = 800;        // DS18B20 12-bit needs 750 ms
constexpr uint32_t MQTT_RETRY_MS = 5000;
constexpr uint32_t CONNECT_TIMEOUT_MS = 15000;
constexpr uint32_t LINK_LOSS_MS = 30000;       // grace before failing over
constexpr uint32_t BROKER_DOWN_MS = 120000;    // link up, broker unreachable
constexpr uint32_t PROBE_MS = 60000;           // primary probe while on secondary
constexpr int8_t RETURN_MIN_RSSI = -80;
constexpr uint8_t RETURN_HITS = 2;
constexpr uint32_t BACKOFF_MIN_MS = 5000;
constexpr uint32_t BACKOFF_MAX_MS = 60000;
constexpr uint32_t HEAP_LOG_MS = 60000;
constexpr wifi_power_t WIFI_TX_POWER = WIFI_POWER_8_5dBm;

static uint32_t tHeap = 0;

static void heapLog() {
  Serial.printf("heap free=%lu min=%lu maxblk=%lu\n", (unsigned long)ESP.getFreeHeap(),
                (unsigned long)ESP.getMinFreeHeap(), (unsigned long)ESP.getMaxAllocHeap());
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 2000) {}  // bounded CDC wait
  wifiBegin();      // WiFi.mode() first: the RNG needs RF on
  settingsBegin();
  sensingBegin();
  portalBegin();
  heapLog();
}

void loop() {
  const uint32_t now = millis();
  wifiTick(now);
  portalTick(now);
  mqttTick(now);
  sensingTick(now);
  if (now - tHeap >= HEAP_LOG_MS) {
    tHeap = now;
    heapLog();
  }
  delay(2);
}
