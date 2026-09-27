# Apply Progress: device-connectivity

Mode: Standard (no test runner, strict_tdd=false). Delivery: single-pr, `size:exception` accepted. Compile-only verification (no flash).

## Batch 1 (Phase 0 + Slice 1)

### Completed
- [x] 0.1 Legacy copy `firmware/sensor_node_legacy/sensor_node_legacy.ino` (byte-identical, `cmp` OK; still includes `secrets.h`)
- [x] 1.1 `app.h`
- [x] 1.2 `settings.ino`
- [x] 1.3 `sensing.ino`
- [x] 1.4 `mqtt_link.ino` (live session only)
- [x] 1.5 `wifi_fsm.ino` part A
- [x] 1.6 `wifi_fsm.ino` part B (no AP calls)
- [x] 1.7 `sensor_node.ino` rewrite (no `secrets.h` include)

### Pending / human-only
- [ ] 0.2 [H] copy `secrets.h` into `firmware/sensor_node_legacy/`
- [ ] 0.3 compile legacy (needs 0.2; not run)
- [ ] 1.8 [H] move/remove `secrets.h` from `firmware/sensor_node/`
- [ ] 1.9 delete `firmware/sensor_node/secrets.example.h` (the delete command was denied by the auto-mode classifier; file untouched, nobody includes it)
- [ ] 1.10 [H] erase + flash slice 1 to COM3

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test command | `arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc firmware/sensor_node --warnings all`: exit 0, no warnings from sketch code (only 3rd-party OneWire `#undef` warnings). Also compiled from a scratch copy containing only `*.ino` + `app.h` (no `secrets.h`): identical result. |
| Size | Flash 983,305 B (75%) of 1,310,720 B; RAM 38,296 B (11%) of 327,680 B |
| Runtime harness | N/A this batch: flash forbidden; slice 1 has no provisioning path, so online/AP paths need slice 2. Pending [H] 1.10. |
| Rollback boundary | Delete the new tabs, restore `sensor_node.ino` from `sensor_node_legacy.ino` (or reflash legacy) |

### Diff size (git diff --stat, authored code)
Slice 1 without legacy copy: about +369 / -66. Legacy copy: +79.

### Deviations from design
- `wifiLockRelease()` used as the name for `wifiLockForTest()/Release()` release side; sets IDLE (restarts at primary).
- `mqttConnected()` added to the public interface (FSM needs it for the 2 min broker-down rule); counted only when an `mqtt` blob exists.
- Event hook stores only `evReason` and `evGotIp`; link-loss detection polls `WiFi.status()` in `ONLINE` instead of a disconnect flag (avoids stale flag after our own `disconnect()`).
- `delay(2)` at the end of `loop()` to yield (allowed, under 50 ms).
- Primary-probe hold-off (task 3.8), `FALLBACK` AP, phone-on-AP backoff pause: left for slice 3 as planned.

## Batch 2 (Slice 2: portal + wizard + tests)

### Completed
- [x] 2.1 Spike (stub `portal.ino`, `WebServer` + `DNSServer`, one route): 1,023,177 B (78%) < 1,179,648 B gate. RAM 38,816 B.
- [x] 2.2 SKIPPED (gate not met): FQBN and `openspec/config.yaml` unchanged, no `min_spiffs`, no extra flash step.
- [x] 2.3 `portal.ino`: softAP `frio-<6 hex>` (WPA2 devpass, ch 1, max 1 station), DNS wildcard, `apRequest/apClear` mask, 302 `onNotFound`, Basic auth on every handler; blank `wifi1` -> `AP_PROVISION`, no STA attempt.
- [x] 2.4 `GET /` and async `GET /api/scan`.
- [x] 2.5 `POST /api/test` (202/409/400), `TestJob` slot wiped on end, `GET /api/status[?id=]` (no passwords, retained 10 min), WiFi test (`wifiTestStart/Poll` in `wifi_fsm.ino`, 15 s, reasons no_ap/auth/timeout/link, logs raw reason code), commit-on-pass, `POST /api/finish` (deferred 1.5 s close).
- [x] 2.6 `mqttTest` in `mqtt_link.ino` (client `cfgtest-<chip>`, no will, hostByName, setServer(ip), 4 s timeout, classes dns/refused/unreachable/no_connack/protocol/client_id/unavailable/bad_credentials/not_authorized/no_wifi/ok).
- [x] 2.7 `portal_html.h` (W1, W2 skippable, MQTT, Finish; 1 s poll, 45 s tolerance; SSIDs inserted via DOM, no innerHTML).
- [x] 2.8 Final compile: flash 1,042,625 B (79%) of 1,310,720 B; RAM 39,288 B (11%) of 327,680 B; no warnings from sketch code.

### Pending / human-only (slice 2)
- [ ] 2.9 [H] flash + phone join/401/captive popup
- [ ] 2.10 [H] WiFi cases
- [ ] 2.11 [H] MQTT cases on :1883
- [ ] 2.12 [H] power cut mid-wizard
(Batch 1 pending items 0.2, 0.3, 1.8, 1.9, 1.10 unchanged.)

### Work Unit Evidence (Slice 2)
| Evidence | Value |
|---|---|
| Focused test command | `arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc firmware/sensor_node --warnings all`: exit 0, no sketch warnings (only 3rd-party OneWire `#undef`). |
| Size | Flash 1,042,625 B (79%); RAM 39,288 B (11%). Spike 1,023,177 B (78%). |
| Runtime harness | N/A this batch (no flash allowed). Pending [H] 2.9-2.12. |
| Rollback boundary | Delete `portal.ino`, `portal_html.h`; revert `portalBegin/portalTick` lines in `sensor_node.ino`, `mqttTest` in `mqtt_link.ino`, `wifiTest*` in `wifi_fsm.ino`, portal/test declarations in `app.h`; flash slice 1. |

### Diff delta added by batch 2 (all additions, 0 deletions)
`portal.ino` 198, `portal_html.h` 37, `mqtt_link.ino` +35, `wifi_fsm.ino` +20, `app.h` +11, `sensor_node.ino` +2 = about +303.

### Deviations from design
- `TestJob.reason` is `const char*` (literal) instead of `uint8_t`; added `saved` flag and `JobState` enum in `app.h`.
- `mqttTest` checks `WiFi.status() == WL_CONNECTED` (not `staOnline()`), so the MQTT step works right after a WiFi step while the FSM is still reconnecting. `no_wifi` otherwise.
- `g_testHost` buffer not needed: `setServer(IPAddress)` is used after `hostByName`.
- The `WebServer` is started only while the AP is up (not reachable over the STA/LAN when the AP is closed).
- WiFi test wait is the full 15 s (no early exit on first disconnect); reason 8 (own `disconnect()`) is ignored.
- `/api/finish` closes the AP 1.5 s later so the reply reaches the phone. A committed MQTT config is used by the live session at its next (re)connect, not forced.
- Idle close, FALLBACK, button, hold-off (slice 3) not started.

## Follow-up: portal UX + auth removal + optional fixed password (delegated direct, post batch 2)
- HTTP Basic auth removed from `portal.ino` (`authed()` deleted, no `authenticate`/`requestAuthentication`): mobile/captive browsers failed on the 401 with empty body. The portal is reachable only through the WPA2 AP; the `WebServer` still listens only while the AP is up. Decision approved by the user; spec `device-access-control` already updated.
- Optional `DEVICE_PASSWORD` from gitignored `secrets.h` (`__has_include` in `settings.ino`): copied into `g_devPass` every boot, never printed, NVS `devpass` untouched, `static_assert` length 8..63. Without it: random per-device password exactly as before. `g_devPass` enlarged to 64 (`settings.ino`, `app.h`).
- `secrets.example.h` rewritten as a documentation-only template for the optional override (obsolete WIFI_*/MQTT_* defines removed).
- `portal_html.h` restyled: mobile-first CSS (48 px controls, 16 px font, dark mode), step indicator, busy/ok/error message states, buttons disabled while a test runs; JS logic and API contracts unchanged.
- Compile (`--warnings all`, no sketch warnings): flash 1,035,739 B (79%) of 1,310,720 B with `DEVICE_PASSWORD` defined; 1,036,345 B without `secrets.h`. RAM 39,336 B (12%). `static_assert` verified to fail on a 5-char password.
- Pending [H]: retest phone join, captive popup and wizard on hardware (2.9-2.12).

## Batch 3 (Slice 3: gestures, FALLBACK/idle AP, hold-off, :1884 infra)

Slices 1 and 2 were verified on hardware before this batch (commit 47bdcc5). Compile-only here (no flash, no docker).

### Completed
- [x] 3.1 `mosquitto.conf`: `per_listener_settings true`, :1883 anonymous, :1884 with `password_file`, comment with the `mosquitto_passwd` command and how to drop the listener.
- [x] 3.3 `docker-compose.yml`: port `1884:1884`, volume `./mosquitto/passwd:/mosquitto/config/passwd:ro` (the docker check depends on the human step 3.2).
- [x] 3.5 `button.ino` (new) + `buttonTick(now)` first in `loop()`: `INPUT_PULLUP` on `BOOT_PIN` (GPIO9, defined by the board variant), armed after the first HIGH read, 30 ms debounce, classified on release with edge timestamps: >= 10 s `factoryReset()` (keeps devpass/schema, restarts into empty-NVS PROVISION), >= 3 s `apRequest(AP_MANUAL)`, otherwise nothing. Logs when 3 s / 10 s are reached and the held time on release.
- [x] 3.6 `wifi_fsm.ino`: `attemptFailed()` entering `BACKOFF` calls `apRequest(AP_FALLBACK)` (no timeout); `goOnline()` calls `apClear(AP_FALLBACK)`; `BACKOFF` timer is held (`tState = now`) while `softAPgetStationNum() > 0`; the primary probe scan also skips while a phone is on the AP.
- [x] 3.7 `portal.ino`: `tIdle` (set when a reason is newly requested and every tick a station is present); at the end of `portalTick`, `MANUAL` plus `PROVISION` (only when `g_hasWifi[0]`) clear after `AP_IDLE_MS` (15 min). Empty-NVS `PROVISION` and `FALLBACK` bits are never cleared by the timer.
- [x] 3.8 `wifi_fsm.ino`: `hold/tHold`; set only in the broker-unreachable branch, cleared on the link-loss failover and when ONLINE on primary; `probePrimary()` returns early for `HOLDOFF_MS` (10 min), then normal 60 s probe / 2 hits at RSSI >= -80 dBm rules.
- [x] 3.9 Compile: flash 1,037,045 B (79%) of 1,310,720 B; RAM 39,360 B (12%) of 327,680 B; no warnings from sketch code (only 3rd-party OneWire `#undef`).

Note: slice 1 already contained the 30 s link-loss grace, the 2 min broker-down switch (only when another network exists) and the 60 s async scan with 2 stable hits; batch 3 added only the hold-off.

### Pending / human-only (slice 3)
- [ ] 3.2 [H] create `infra/mosquitto/passwd` with `mosquitto_passwd` (see the command in `mosquitto.conf` / task 3.2), then `docker compose up -d` and check :1884 (anonymous refused, credentials work, :1883 unchanged)
- [ ] 3.4 [H] wizard MQTT test against :1884: wrong credentials -> `bad_credentials`/`not_authorized`, correct ones save
- [ ] 3.10 [H] button gestures on hardware
- [ ] 3.11 [H] failover / hold-off / both-down matrix with router toggling and `docker stop`
- [ ] 3.12 [H] 15 min idle close and never-close cases
- Phase 4 (4.1 soak, 4.2 topic audit, 4.3 final build) not started; batch 1/2 [H] items unchanged (0.2, 0.3, 1.8, 1.9, 1.10, 2.9-2.12).

### Work Unit Evidence (Slice 3)
| Evidence | Value |
|---|---|
| Focused test command | `arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc firmware/sensor_node --warnings all`: exit 0, no sketch warnings. |
| Size | Flash 1,037,045 B (79%); RAM 39,360 B (12%). |
| Runtime harness | N/A this batch (no flash, no docker allowed). Pending [H] 3.2, 3.4, 3.10-3.12. |
| Rollback boundary | Delete `button.ino`; revert the slice 3 hunks in `wifi_fsm.ino`, `portal.ino`, `sensor_node.ino`, `app.h`; drop the :1884 block, port and mount from `infra/`. |

### Diff delta (batch 3)
`button.ino` +45 (new), `wifi_fsm.ino` +21/-3, `portal.ino` +12, `sensor_node.ino` +6, `app.h` +3, `mosquitto.conf` +13, `docker-compose.yml` +2: about +102 / -3.

### Deviations from design
- `BOOT_PIN` is not declared in the sketch: the ESP32-C3 board variant already defines `BOOT_PIN = 9` (redeclaring it broke the build). Debounce/threshold/idle/hold-off constants are in `sensor_node.ino`.
- Idle timer clears only the `MANUAL` and (with wifi1) `PROVISION` bits, so a `FALLBACK` bit keeps the AP up.
- BACKOFF pause restarts the current interval when the phone leaves (rather than resuming the remaining time).
- 10 s press restarts the board right after the wipe (existing `factoryReset()`), so config mode comes from the empty-NVS boot path.
