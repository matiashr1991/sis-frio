#include <WiFi.h>
#include <PubSubClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "secrets.h"

constexpr uint8_t ONE_WIRE_PIN = 4;
constexpr uint32_t PUBLISH_INTERVAL_MS = 10000;
constexpr const char* SITE_ID = "sucursal1";

OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature sensors(&oneWire);
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

char statusTopic[48];
uint32_t lastPublish = 0;

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("WiFi: connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("WiFi: connected, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.printf("WiFi: failed, status %d\n", WiFi.status());
  }
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  Serial.printf("MQTT: connecting to %s:%d\n", MQTT_HOST, MQTT_PORT);
  // Last Will: the broker publishes "offline" (retained) if this node drops.
  if (mqtt.connect(SITE_ID, nullptr, nullptr, statusTopic, 1, true, "offline")) {
    mqtt.publish(statusTopic, "online", true);
    Serial.println("MQTT: connected");
  } else {
    Serial.printf("MQTT: failed, rc=%d\n", mqtt.state());
  }
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  snprintf(statusTopic, sizeof(statusTopic), "frio/%s/status", SITE_ID);
  sensors.begin();
  Serial.printf("Sensors found: %d\n", sensors.getDeviceCount());
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  connectWifi();
}

void loop() {
  connectWifi();
  connectMqtt();
  mqtt.loop();

  if (millis() - lastPublish < PUBLISH_INTERVAL_MS) return;
  lastPublish = millis();

  sensors.requestTemperatures();
  const uint8_t count = sensors.getDeviceCount();
  for (uint8_t i = 0; i < count; i++) {
    const float t = sensors.getTempCByIndex(i);
    if (t == DEVICE_DISCONNECTED_C) {
      Serial.printf("Sensor %d: read error\n", i);
      continue;
    }
    char topic[48], payload[16];
    snprintf(topic, sizeof(topic), "frio/%s/cam%d/temp", SITE_ID, i + 1);
    snprintf(payload, sizeof(payload), "%.2f", t);
    const bool ok = mqtt.connected() && mqtt.publish(topic, payload);
    Serial.printf("%s = %s C (%s)\n", topic, payload, ok ? "published" : "NOT published");
  }
}
