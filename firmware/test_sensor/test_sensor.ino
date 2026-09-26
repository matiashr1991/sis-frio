#include <OneWire.h>
#include <DallasTemperature.h>

// DS18B20 bus on GPIO4 (4.7k pull-up to 3.3V)
constexpr uint8_t ONE_WIRE_PIN = 4;

OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature sensors(&oneWire);

void setup() {
  Serial.begin(115200);
  delay(2000);  // give USB CDC time to enumerate
  sensors.begin();
  Serial.printf("Sensors found: %d\n", sensors.getDeviceCount());
}

void loop() {
  sensors.requestTemperatures();
  const uint8_t count = sensors.getDeviceCount();
  for (uint8_t i = 0; i < count; i++) {
    const float t = sensors.getTempCByIndex(i);
    if (t == DEVICE_DISCONNECTED_C) {
      Serial.printf("Sensor %d: read error\n", i);
    } else {
      Serial.printf("Sensor %d: %.2f C\n", i, t);
    }
  }
  if (count == 0) Serial.println("No sensors detected - check wiring and pull-up");
  delay(2000);
}
