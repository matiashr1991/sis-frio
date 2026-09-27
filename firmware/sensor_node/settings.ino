// NVS namespace "conn": schema, wifi1, wifi2, mqtt, devpass.
#include <Preferences.h>

static Preferences prefs;
WifiCred g_wifi[2];
bool g_hasWifi[2];
MqttCfg g_mqtt;
bool g_hasMqtt;
char g_devPass[64];

#if __has_include("secrets.h")
#include "secrets.h"  // optional: may define DEVICE_PASSWORD (fixed password, MVP/own devices only)
#endif
#ifdef DEVICE_PASSWORD
static_assert(sizeof(DEVICE_PASSWORD) - 1 >= 8 && sizeof(DEVICE_PASSWORD) - 1 <= 63, "DEVICE_PASSWORD must be 8..63 chars");
#endif

static bool loadBlob(const char* key, void* dst, size_t len) {
  if (prefs.getBytesLength(key) != len) return false;
  return prefs.getBytes(key, dst, len) == len;
}

// Must run after WiFi.mode(): esp_random() is only truly random with RF on.
void settingsBegin() {
  prefs.begin("conn", false);
  if (!prefs.getUChar("schema", 0)) prefs.putUChar("schema", 1);

  const char* wkeys[2] = {"wifi1", "wifi2"};
  for (uint8_t i = 0; i < 2; i++) {
    g_hasWifi[i] = loadBlob(wkeys[i], &g_wifi[i], sizeof(WifiCred));
    g_wifi[i].ssid[sizeof(g_wifi[i].ssid) - 1] = 0;
    g_wifi[i].pass[sizeof(g_wifi[i].pass) - 1] = 0;
  }
  g_hasMqtt = loadBlob("mqtt", &g_mqtt, sizeof(MqttCfg));
  g_mqtt.host[sizeof(g_mqtt.host) - 1] = 0;
  g_mqtt.user[sizeof(g_mqtt.user) - 1] = 0;
  g_mqtt.pass[sizeof(g_mqtt.pass) - 1] = 0;

#ifdef DEVICE_PASSWORD
  strlcpy(g_devPass, DEVICE_PASSWORD, sizeof(g_devPass));  // fixed password: never printed, NVS untouched
#else
  // getString() returns the length including the NUL, so validate with strlen().
  if (!prefs.getString("devpass", g_devPass, sizeof(g_devPass)) || strlen(g_devPass) != 12) {
    static const char ALPHABET[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";  // 32 symbols, no I/O/0/1
    for (uint8_t i = 0; i < 12; i++) g_devPass[i] = ALPHABET[esp_random() & 31];
    g_devPass[12] = 0;
    prefs.putString("devpass", g_devPass);
    Serial.printf("DEVICE PASSWORD: %s\n", g_devPass);  // printed once, for the label
  }
#endif
  Serial.printf("NVS: wifi1=%d wifi2=%d mqtt=%d\n", g_hasWifi[0], g_hasWifi[1], g_hasMqtt);
}

bool commitWifi(uint8_t slot, const WifiCred& c) {
  if (prefs.putBytes(slot ? "wifi2" : "wifi1", &c, sizeof(c)) != sizeof(c)) return false;
  g_wifi[slot] = c;
  g_hasWifi[slot] = true;
  return true;
}

bool commitMqtt(const MqttCfg& c) {
  if (prefs.putBytes("mqtt", &c, sizeof(c)) != sizeof(c)) return false;
  g_mqtt = c;
  g_hasMqtt = true;
  return true;
}

// Wipes network config only; keeps devpass and schema so the label stays valid.
void factoryReset() {
  prefs.remove("wifi1");
  prefs.remove("wifi2");
  prefs.remove("mqtt");
  Serial.println("Factory reset: network config wiped");
  ESP.restart();
}
