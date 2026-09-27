// BOOT (GPIO9, active LOW, BOOT_PIN comes from the board variant) gestures, polled and debounced, classified on release:
// >= 10 s factory reset (network config only, device password kept), >= 3 s manual config AP.
static bool btnArmed = false;   // only after the pin read HIGH once (BOOT may be held at reset)
static bool btnRaw = false;     // last raw sample: true = pressed
static bool btnDown = false;    // debounced state
static uint32_t tBtnEdge = 0;   // time of the last raw edge
static uint32_t tBtnDown = 0;   // press start
static uint8_t btnShown = 0;    // thresholds already logged for this press

void buttonTick(uint32_t now) {
  if (!btnArmed) {
    pinMode(BOOT_PIN, INPUT_PULLUP);
    btnArmed = digitalRead(BOOT_PIN) == HIGH;
    return;
  }
  const bool low = digitalRead(BOOT_PIN) == LOW;
  if (low != btnRaw) {
    btnRaw = low;
    tBtnEdge = now;
  }
  if (btnRaw != btnDown && now - tBtnEdge >= BTN_DEBOUNCE_MS) {
    btnDown = btnRaw;
    if (btnDown) {
      tBtnDown = tBtnEdge;
      btnShown = 0;
      return;
    }
    const uint32_t held = tBtnEdge - tBtnDown;  // release
    Serial.printf("BOOT released after %lu ms\n", (unsigned long)held);
    if (held >= BTN_RESET_MS) factoryReset();
    else if (held >= BTN_MANUAL_MS) apRequest(AP_MANUAL);
    return;
  }
  if (btnDown) {
    const uint32_t held = now - tBtnDown;
    if (btnShown < 2 && held >= BTN_RESET_MS) {
      btnShown = 2;
      Serial.println("BOOT: 10 s reached (release = factory reset)");
    } else if (btnShown < 1 && held >= BTN_MANUAL_MS) {
      btnShown = 1;
      Serial.println("BOOT: 3 s reached (release = config AP)");
    }
  }
}
