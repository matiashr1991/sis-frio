// Bus level diagnostic: GPIO4 with no internal pull-up, then a presence pulse test
constexpr uint8_t PIN = 4;

void setup() {
  Serial.begin(115200);
  delay(2000);
}

void loop() {
  pinMode(PIN, INPUT);
  delay(50);
  Serial.printf("Idle level (no internal pull-up): %s\n", digitalRead(PIN) ? "HIGH (pull-up present)" : "LOW (no pull-up or DATA shorted to GND)");

  // 1-Wire reset: pull low 480us, release, sample presence at ~70us
  pinMode(PIN, OUTPUT); digitalWrite(PIN, LOW); delayMicroseconds(480);
  pinMode(PIN, INPUT); delayMicroseconds(70);
  const int presence = digitalRead(PIN);
  delayMicroseconds(410);
  Serial.printf("Presence pulse: %s\n", presence == LOW ? "YES (a device answered)" : "NO");
  delay(2000);
}
