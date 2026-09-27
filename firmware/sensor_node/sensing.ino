// Async DS18B20 cycle: request at T, read + publish at T+800 ms (12-bit needs 750 ms).
#include <OneWire.h>
#include <DallasTemperature.h>

static OneWire oneWire(ONE_WIRE_PIN);
static DallasTemperature sensors(&oneWire);
static uint32_t tRequest = 0;
static bool converting = false;

void sensingBegin() {
  sensors.begin();
  sensors.setWaitForConversion(false);
  Serial.printf("Sensors found: %d\n", sensors.getDeviceCount());
}

void sensingTick(uint32_t now) {
  if (!converting) {
    if (now - tRequest < PUBLISH_INTERVAL_MS) return;
    tRequest = now;
    if (!sensors.getDeviceCount()) {  // none at boot (late power-up, loose contact): rescan every cycle
      sensors.begin();
      sensors.setWaitForConversion(false);
      if (sensors.getDeviceCount()) Serial.printf("Sensors found: %d\n", sensors.getDeviceCount());
    }
    sensors.requestTemperatures();
    converting = true;
    return;
  }
  if (now - tRequest < CONVERSION_MS) return;
  converting = false;

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
    const bool ok = mqttPublish(topic, payload);
    Serial.printf("%s = %s C (%s)\n", topic, payload, ok ? "published" : "NOT published");
  }
}
