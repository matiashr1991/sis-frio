# Exploration: device-connectivity

Layer 1 of 3 (1 device-connectivity, 2 device-config + MQTT contract, 3 server-alerts).
Scope: how the ESP32-C3 gets onto a network from a phone at a customer site. Engram mirror: `sdd/device-connectivity/explore`.

## Current State

- `firmware/sensor_node/sensor_node.ino` (~80 lines, single file): WiFi credentials come from compile-time `secrets.h`.
- `connectWifi()` blocks up to 20 s (`delay(500)` loop); `connectMqtt()` blocks up to 15 s (PubSubClient default socket timeout). Both run at the top of `loop()`, so any outage stalls sensing and would starve a WebServer.
- Publishing every 10 s; DS18B20 on GPIO4; topics `frio/<site>/cam<N>/temp` and retained `frio/<site>/status` with Last Will; `SITE_ID` is a constexpr.
- Toolchain: esp32 core 3.3.12, PubSubClient 2.8 (256 B buffer, keepalive 15, socket timeout 15). WebServer, DNSServer, Preferences and WiFi ship with the core; no WiFiManager or AsyncWebServer installed.
- `infra/mosquitto/mosquitto.conf`: `allow_anonymous true`, no password file (accepts any credentials).
- Default C3 partition scheme: app0 = 1,310,720 B; ~970 KB used (74%), ~340 KB free.

## Affected Areas

- `firmware/sensor_node/sensor_node.ino`: refactor to a non-blocking loop, split into tabs (settings, wifi state machine, portal, mqtt link, sensing).
- `firmware/sensor_node/secrets.example.h`: demote to optional dev seed or remove.
- `infra/mosquitto/mosquitto.conf`: optional second listener with a password file (e.g. :1884) to test MQTT credential rejection.
- `openspec/config.yaml`: `build_command` FQBN needs `PartitionScheme=min_spiffs` if the default scheme overflows.

## Findings

### 1. Feasibility and gotchas (esp32 core 3.3.12, C3)

- **Single radio in AP+STA.** When the STA joins a router on another channel, the softAP is forced onto that channel and the phone drops. UI design: `POST /api/test` returns 202 immediately; the device tests without blocking; the UI polls `GET /api/status` ~1/s and tolerates fetch failures for 30-40 s; the result is kept in RAM keyed by a test id so the UI resumes after the phone reconnects. Scan with async `scanNetworks(true)`, only on user request (scans hop channels).
- **Status codes.** Prefer `WiFi.onEvent(ARDUINO_EVENT_WIFI_STA_DISCONNECTED)` reason codes (201 no AP; 202/204/15 auth/handshake) over `WiFi.status()`. Success means GOT_IP. Time out a test at ~15 s and call `WiFi.disconnect(false,false)`.
- **Persistence trap.** Arduino WiFi persists credentials to its own NVS on `WiFi.begin` unless `WiFi.persistent(false)` is set first. Without it, a failed test overwrites stored credentials.
- **Captive portal.** `DNSServer(53,"*",192.168.4.1)` + `onNotFound` 302 redirect covers Android/iOS/Windows probes. Nice-to-have; also print the URL on the label.
- **TX power.** Super Mini clones may drop at default power; `WiFi.setTxPower(WIFI_POWER_8_5dBm)` after WiFi start (community-documented). Keep as constexpr; confirm RSSI on site.
- **BOOT button conflict (critical).** GPIO9 held LOW at reset puts the ESP32-C3 in ROM download mode. "Hold BOOT at boot" will not run the app; use a long press (>= 3 s) sampled after boot, in the first 5-10 s window and/or at any time while running.
- **Passwords.** WPA2 needs >= 8 chars. A chip-ID-derived password is guessable if the source is public: use a salt in gitignored `secrets.h` + sha256, or a random value generated on first boot, stored in NVS and printed on serial for label printing. Protect the admin page with `server.authenticate()`. URL-decode form fields. Never echo stored passwords.
- **One STA interface.** Testing a WiFi network drops the live STA link, so publishing pauses during WiFi test steps while sensing continues. No store-and-forward in Layer 1.
- **PubSubClient pointer.** `setServer(const char*)` keeps the pointer; the host must live in a global buffer.

### 2. Approach comparison

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| Custom WebServer + DNSServer + Preferences | Zero dependencies; full control of test-before-save, two networks, MQTT step, state machine; HTML in PROGMEM | ~500-600 lines incl. HTML/JS; synchronous WebServer (fine for one phone) | Medium |
| tzapu WiFiManager | Fast for a single network | Persists one credential set before success is known; no secondary/failover; no MQTT test; blocking `autoConnect`; core 3.x compat unverified | Medium (fighting the library) |
| ESPAsyncWebServer + AsyncTCP | Non-blocking, own task | Third-party deps; thread-safety with state machine and PubSubClient; more RAM; overkill for one client | High |

Recommendation: custom.

### 3. Failover state machine

- WiFiMulti has no priority, no "return to primary", blocking `run()`. Use a custom machine.
- States: BOOT -> CONNECT_PRIMARY -> ONLINE_PRIMARY -> (link lost > N = 30 s) -> CONNECT_SECONDARY -> ONLINE_SECONDARY -> probe primary ~every 60 s -> back.
- Primary probe: async scan, two consecutive hits and an RSSI floor as hysteresis.
- Both fail: CONFIG_AP_OPEN with STA retry backoff 5 s to 60 s.
- Connect attempt timeout 15 s; `setAutoReconnect(false)` for determinism.
- Pause STA retries while a phone is on the AP (retry scans hop the AP channel).
- Normal ONLINE operation: STA only, AP off.

### 4. MQTT test-before-save

- Separate PubSubClient + WiFiClient, client id `cfgtest-<chip>` (never `SITE_ID`, the broker would kick the live session). No Last Will; disconnect cleanly.
- `setSocketTimeout(4)`; worst-case block ~7-8 s (hostname DNS can add more). Prefer bounded blocking in the cooperative loop; escalate to a one-shot FreeRTOS task only if measured stalls matter.
- `state()`: -2 TCP/DNS failure; -4 no CONNACK; 1 bad protocol; 2 bad client id; 3 unavailable; 4 bad credentials; 5 not authorized.
- Testing credentials requires an authenticated broker (current one accepts anything).

### 5. Flash and RAM budget

- ~340 KB free vs. an estimated 60-120 KB for WebServer + DNSServer + Preferences + HTML (estimate; measure with a compile spike).
- Default scheme should fit and keeps OTA. Fallback: `PartitionScheme=min_spiffs` (app 1,966,080 B, OTA kept); a scheme change needs a USB reflash.
- Keep AP off in normal operation; log `ESP.getFreeHeap()` / `getMinFreeHeap()`.
- C3 is single core: cooperative loop, no `delay()` over 50 ms, no synchronous scans, DS18B20 `setWaitForConversion(false)`. PubSubClient is not thread-safe.
- Preferences namespace `conn` (keys <= 15 chars) persists each wizard step independently, so a partial wizard leaves a working config.

### 6. Verification strategy (no test runner)

- Compile: `arduino-cli compile --warnings all`; check size vs. 1,310,720 B.
- Flash + serial: state-transition log with disconnect reason codes, heap, masked credential lengths only.
- `mosquitto_sub -t '#' -v`: publishing continues while portal is up; nothing outside `frio/#`; no credentials on any topic.
- Phone: captive popup, wizard flow, polling survives the channel drop.

Manual test matrix:
- WiFi failures: wrong password; SSID absent; 5 GHz-only SSID; hidden SSID; router on another channel.
- WiFi success: primary and secondary.
- MQTT: wrong host; closed port; firewalled port; wrong credentials (authenticated listener); success.
- Persistence: power cut mid-wizard then reboot (nothing persisted); config survives reboot.
- Failover: primary off -> secondary after N s; primary back -> returns; both down -> AP reopens while sensing continues.
- Config mode entry and admin: BOOT long press; wrong admin password.
- Input handling: special characters; max lengths (SSID 32, password 63).
- Endurance: 30-minute AP soak watching heap.
- Phone-hotspot secondary (iPhone needs "Maximize Compatibility" for 2.4 GHz).

## Recommendation

Custom WebServer + DNSServer + Preferences with per-step persistence; non-blocking refactor of the sketch; custom failover state machine; default partition scheme first, `min_spiffs` as fallback.

Suggested slicing inside the single PR:
1. Non-blocking refactor, NVS settings, state machine.
2. Portal, wizard, tests.
3. BOOT long press, AP reopen, hardening.

## Risks

- GPIO9 strapping conflict (BOOT gesture design).
- AP+STA channel switch drops the phone connection.
- Forgetting `WiFi.persistent(false)` overwrites stored credentials on failed tests.
- Anonymous broker cannot validate credential rejection.
- Flash impact of the web server is estimated, not measured.
- Label-password derivation guessable if source is public.
- AP left open at a customer site is an attack surface.
- MQTT test blocks the loop up to ~8 s.
- Estimated 550-700 authored lines vs. 800-line budget: medium to high risk.

## Open product questions

1. AP and admin password: salted hash from chip ID (needs label-printing workflow) vs. random on first boot? One password or two?
2. BOOT gesture: is a long press after boot acceptable (GPIO9 download-mode conflict)? Is the button reachable in the enclosure?
3. Failover trigger and timings: WiFi link loss only, or also broker unreachable? N = 30 s OK? Auto-return to primary probing every 60 s (data cost on a phone hotspot)?
4. Both networks down: AP open indefinitely, or timeout/schedule? Pause STA retries while a phone is connected?
5. Fate of `secrets.h` and first boot with empty NVS (config mode only, or dev-seed fallback)? Explicit factory-reset gesture? Does `SITE_ID` stay constexpr until Layer 2?

## Ready for Proposal

Yes, once the open questions are answered (Q2 changes the design).
