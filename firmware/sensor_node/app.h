#pragma once
#include <Arduino.h>

// Persisted wizard steps: one NVS blob each (atomic on power cut).
struct WifiCred { char ssid[33]; char pass[64]; };
struct MqttCfg { char host[64]; uint16_t port; char user[65]; char pass[65]; };

enum StaState : uint8_t { STA_IDLE, STA_CONNECTING, STA_ONLINE, STA_RECOVERING, STA_BACKOFF, STA_TESTING };
enum ApReason : uint8_t { AP_PROVISION = 1, AP_MANUAL = 2, AP_FALLBACK = 4 };

// Background test slot used by the portal. step: 0=w1 1=w2 2=mq. reason points to a literal.
enum JobState : uint8_t { JOB_NONE, JOB_RUN, JOB_OK, JOB_FAIL };
struct TestJob { uint32_t id; uint8_t step; uint8_t state; bool saved; bool started; const char* reason; uint32_t t0; WifiCred cred; MqttCfg mq; };

// settings.ino
extern WifiCred g_wifi[2];   // [0] primary, [1] secondary
extern bool g_hasWifi[2];
extern MqttCfg g_mqtt;
extern bool g_hasMqtt;
extern char g_devPass[64];   // 63 chars + NUL (optional fixed DEVICE_PASSWORD) or 12 random chars
void settingsBegin();
bool commitWifi(uint8_t slot, const WifiCred& c);
bool commitMqtt(const MqttCfg& c);
void factoryReset();

// wifi_fsm.ino
extern StaState g_sta;
void wifiBegin();
void wifiTick(uint32_t now);
bool staOnline();
const char* wifiReason(uint8_t code);
void wifiLockForTest();
void wifiLockRelease();
void wifiTestStart(const WifiCred& c, uint32_t now);
int wifiTestPoll(uint32_t now, const char** reason);  // 0 running, 1 ok, -1 failed

// mqtt_link.ino
void mqttTick(uint32_t now);
bool mqttConnected();
bool mqttPublish(const char* topic, const char* payload);
bool mqttTest(const MqttCfg& c, const char** reason);

// sensing.ino
void sensingBegin();
void sensingTick(uint32_t now);

// portal.ino
void portalBegin();
void portalTick(uint32_t now);
void apRequest(uint8_t reason);
void apClear(uint8_t reason);
void chipTag(char out[7]);  // last 3 bytes of the efuse MAC, upper-case hex
