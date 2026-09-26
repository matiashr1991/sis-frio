# Tasks: Device Connectivity (Layer 1 of 3)

Legend: `[H]` = human-only step (agents MUST NOT do it). Agents never open, print or copy `firmware/sensor_node/secrets.h`. FQBN = `esp32:esp32:esp32c3:CDCOnBoot=cdc`. `BUILD` = `arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc --warnings all firmware/sensor_node`. No test runner exists; every task ends with a manual check. Line counts in `(~N)` are additions only.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Slice 1 ~480 (+~80 deleted), Slice 2 ~330, Slice 3 ~110. Total ~920 added (design), ~1,000 counting deletions |
| Session review budget | 800 lines (single-pr); default guard budget is 400 |
| 400-line budget risk | High (exceeds both 400 and the 800 session budget by ~120 lines added, ~200 with deletions) |
| Chained PRs recommended | Yes (the 3 slices are natural units) |
| Suggested split | PR 1 = slice 1, PR 2 = slice 2, PR 3 = slice 3 (or one PR with `size:exception`) |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Honesty note: the design's 920 excludes the ~80-line verbatim legacy copy (mechanical) and counts additions only; the guard rule counts additions plus deletions, so ~1,000 is the conservative figure. Under `single-pr`, apply is blocked until a `size:exception` is accepted or the slices are split.

Levers to reduce lines without cutting confirmed scope (realistic total saving ~60-90, so the result is still ~830-860 and above 800): minimal portal HTML with no CSS beyond a few rules (~20-30); one compact heap log line instead of three (~8); terse reason-code and button-threshold logging (~15); one shared validate helper for all steps (~10); no temporary dev seed console (~50 added and removed, already excluded). The levers cannot reach 800 alone, so a decision is still needed.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Non-blocking loop, NVS settings, STA FSM (no AP), password | PR 1 | `BUILD` | Flash on COM3, serial: password once, sensing every 10 s offline | Reflash `sensor_node_legacy` |
| 2 | Portal, wizard, test-before-save | PR 2 | `BUILD` | Phone wizard against the device, `mosquitto_sub -t 'frio/#' -v` | Revert portal files, flash slice 1 |
| 3 | Gestures, AP reopen/idle close, anti-flap, :1884 infra | PR 3 | `BUILD` | Button + router toggling + `mosquitto_sub -p 1884` | Revert slice 3 files; drop :1884 block, port, mount |

## Phase 0: Rollback copy

- [ ] 0.1 Copy `firmware/sensor_node/sensor_node.ino` verbatim to `firmware/sensor_node_legacy/sensor_node_legacy.ino` (folder name must match). Check: file exists and is byte-identical. Satisfies proposal rollback plan.
- [ ] 0.2 [H] User copies `secrets.h` into `firmware/sensor_node_legacy/` by hand.
- [ ] 0.3 Compile legacy: `arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc firmware/sensor_node_legacy`. Check: success; record baseline size.

## Phase 1: Slice 1, non-blocking refactor + NVS + state machine (~480)

- [ ] 1.1 Create `firmware/sensor_node/app.h`: `WifiCred`, `MqttCfg`, `StaState`, `ApReason`, `TestJob`, externs, prototypes (~60). Check: `BUILD` still compiles once included.
- [ ] 1.2 Create `settings.ino`: `settingsBegin()` after `WiFi.mode()`, blobs `wifi1/wifi2/mqtt`, `schema`, `commitWifi/commitMqtt`, `factoryReset()` (removes network blobs only, keeps `devpass`), 12-char password via `esp_random()&31` printed once (~90). Spec: first boot / later boots password, factory-reset password kept, atomic per-step persistence. Check: serial shows `DEVICE PASSWORD:` once; second boot does not print it.
- [ ] 1.3 Create `sensing.ino`: async DS18B20, `setWaitForConversion(false)`, request at T, read and publish at T+800 ms, period 10 s (~45). Spec: Sensing never stops. Check: serial temps every 10 s.
- [ ] 1.4 Create `mqtt_link.ino` live session: `g_mqHost` buffer, `setSocketTimeout(4)`, 5 s reconnect spacing, LWT `frio/sucursal1/status`, unchanged topics, publish only when online (~80). Spec: Publishing contract preserved. Check: compile.
- [ ] 1.5 Create `wifi_fsm.ino` (part A): `WiFi.persistent(false)` first, `setAutoReconnect(false)`, event hook with `volatile` reason and got-IP flag, reason map (`no_ap/auth/link`), 15 s attempt timeout, `CONNECTING/ONLINE/RECOVERING`, 30 s grace, TX power constexpr re-applied (~80). Spec: Deterministic connect behavior, failed tests never overwrite credentials. Check: compile.
- [ ] 1.6 Extend `wifi_fsm.ino` (part B): broker-down 2 min switch, `BACKOFF` 5..60 s, primary probe every 60 s with 2 hits at RSSI >= -80 dBm using `scanNetworks(true)` + `scanDelete()`, `wifiLockForTest()/Release()` (~70). No AP calls yet. Spec: Failover to secondary, Return to primary. Check: compile.
- [ ] 1.7 Rewrite `sensor_node.ino`: remove `#include "secrets.h"`, keep constexpr `SITE_ID="sucursal1"`, bounded 2 s CDC wait, cooperative `loop()`, heap log (`getFreeHeap/getMinFreeHeap/getMaxAllocHeap`) every 60 s (~55, ~80 deleted). Spec: Build has no secrets, sensing while offline. Check: `BUILD` succeeds.
- [ ] 1.8 [H] Move or remove `secrets.h` from `firmware/sensor_node/` (after task 0.2). Check: `BUILD` still succeeds without it (scenario Build has no secrets).
- [ ] 1.9 Delete `firmware/sensor_node/secrets.example.h` (no longer included). Check: `BUILD`.
- [ ] 1.10 [H] Erase flash and flash slice 1 to COM3. Check on serial 115200: password printed once, `[H]` user writes it on the device label; no `delay()` stalls; temp reads every 10 s while offline with no publishes; heap line every 60 s. The blank-NVS AP and online paths cannot be exercised until slice 2 (no provisioning path exists yet; no temporary seed console is planned).

## Phase 2: Slice 2, portal + wizard + tests (~330)

- [ ] 2.1 Compile spike: throwaway `portal.ino` stub linking `WebServer` + `DNSServer` with one route; run `BUILD` and record the size. GATE: if size is above 1,179,648 B (90%, design threshold measured before real portal code) or any later build exceeds 1,310,720 B, go to 2.2; else skip 2.2.
- [ ] 2.2 (conditional) Switch FQBN to `esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=min_spiffs` (app 1,966,080 B); update `build_command` and `context` in `openspec/config.yaml`; confirm NVS at 0x9000/0x5000 in the core `partitions/*.csv`. [H] One USB flash is required. Check: `BUILD` with the new FQBN.
- [ ] 2.3 Replace the stub in `portal.ino` with softAP `frio-<6 hex MAC>` (WPA2 `devpass`, ch 1, max 1 station, `WIFI_AP_STA`), DNS wildcard, `apRequest/apClear` reason mask, `onNotFound` 302 to `http://192.168.4.1/`, auth helper on every handler (~60). Boot with no `wifi1` sets `PROVISION` with no STA attempt. Spec: Empty-NVS boot, Protected AP and captive portal, Wrong password 401. Check: serial shows AP up, no STA attempt.
- [ ] 2.4 `portal.ino`: `GET /` and `GET /api/scan` (async, `{state,nets}`) (~25). Check: phone sees the wizard and networks.
- [ ] 2.5 `portal.ino`: `POST /api/test` (form-urlencoded, length validation, 202 with `{id}`, 409 if busy), `TestJob` slot with `memset` on end, `GET /api/status` (no passwords, retained 10 min by id), WiFi test job (`TESTING`, 15 s, reason classes), commit on pass only, `POST /api/finish` (~85). Spec: Test-before-save, WiFi verdicts, Non-blocking test API, Failed step not saved. Check: serial shows reason code and lengths only.
- [ ] 2.6 `mqtt_link.ino`: `mqttTest(cfg,&reason)` with client `cfgtest-<chip>`, no will, `hostByName` then `setServer(ip)`, `setSocketTimeout(4)`, state classification (`dns/refused/unreachable/no_connack/bad_credentials/not_authorized/ok`), `no_wifi` fast fail; wire the `mq` step in `portal.ino` (~60). Spec: MQTT test verdicts, Live session untouched.
- [ ] 2.7 Create `portal_html.h`: one minimal `PAGE_HTML` in `PROGMEM` (W1, W2, MQTT, Finish), 1 s polling, 45 s fetch-failure tolerance, "rejoin frio-xxxx" message (~70). Check: `BUILD`; page loads on the phone.
- [ ] 2.8 Compile: `BUILD`; record final size against 1,310,720 B (or `min_spiffs` limit).
- [ ] 2.9 [H] Flash; phone: join AP with the label password, wrong password gives 401, correct one loads the wizard; captive popup or `192.168.4.1` (open question: iOS fallback is Safari). Spec: Captive popup, Correct password.
- [ ] 2.10 [H] WiFi cases: wrong password, absent SSID, 5 GHz-only, hidden, other channel report a class and the `wifi1` blob is unchanged after reboot; success on primary and secondary; iPhone hotspot as secondary saves and survives reboot; 32-char SSID + 63-char password with `&%+ "` round-trips. Spec: Wrong password retest, Failure classes, Success, Special characters.
- [ ] 2.11 [H] MQTT cases on :1883: wrong host, closed port, firewalled port, valid. Run `mosquitto_sub -t 'frio/#' -v` and confirm the live session and `frio/sucursal1/status` do not change. Record the longest measured stall; escalate to a FreeRTOS task only if > 10 s. Bad-credential classes are verified in 3.4 once :1884 exists.
- [ ] 2.12 [H] Power cut mid-wizard (unplug during a test) keeps earlier steps; reboot after step 1 uses saved primary; phone reconnect after 30-40 s shows the retained result. Spec: Power cut, Partial wizard, Channel-switch drop.

## Phase 3: Slice 3, gestures + AP reopen/idle close + anti-flap + infra (~110)

- [ ] 3.1 `infra/mosquitto/mosquitto.conf`: `per_listener_settings true`, :1883 anonymous unchanged, :1884 with `password_file` (~12). Check: config reviewed against design §7.
- [ ] 3.2 [H] From `infra/`: `docker run --rm -v ${PWD}/mosquitto:/work eclipse-mosquitto:2 mosquitto_passwd -c -b /work/passwd frio-test <password>` (user picks the password; the file must exist before the compose restart).
- [ ] 3.3 `infra/docker-compose.yml`: add port `1884:1884` and volume `./mosquitto/passwd:/mosquitto/config/passwd:ro` (~4). Check: `docker compose up -d`; `mosquitto_sub -p 1884 -t '#'` without credentials is refused, with them works; `:1883` unchanged. Spec: Authenticated test listener (Rejection).
- [ ] 3.4 [H] Wizard MQTT test against :1884 with wrong user/password gives `bad_credentials` or `not_authorized`; correct credentials save. Spec: MQTT Failure classes.
- [ ] 3.5 Create `button.ino`: GPIO9 `INPUT_PULLUP`, arm after first HIGH, 30 ms debounce, classify on release: >= 10 s `factoryReset()` + restart, >= 3 s `apRequest(MANUAL)`, < 3 s nothing (~45); call `buttonTick(now)` from `sensor_node.ino` (~2). Spec: BOOT long press, BOOT 10 s factory reset.
- [ ] 3.6 `wifi_fsm.ino` + `portal.ino`: on both networks failed request `FALLBACK` AP (no timeout); `BACKOFF` pauses while `softAPgetStationNum()>0`; leaving `BACKOFF/IDLE` for `ONLINE` clears `FALLBACK` (~25). Spec: AP reopens when both down.
- [ ] 3.7 `portal.ino`: 15 min idle close for `MANUAL` and `PROVISION` (only when `wifi1` exists), timer counts from the last station leaving; never for empty-NVS `PROVISION` or `FALLBACK` (~15). Spec: Config AP idle close (all 4 scenarios).
- [ ] 3.8 `wifi_fsm.ino`: 10 min hold-off on primary probe/return, set only for broker-triggered failover, not for link-loss failover (~10). Spec: Hold-off after broker-triggered failover.
- [ ] 3.9 Compile: `BUILD`; record size.
- [ ] 3.10 [H] Flash; button: < 3 s no change; 3 s opens AP and config survives reboot; 10 s wipes network keys, AP opens with the same label password. Serial shows 3 s/10 s thresholds.
- [ ] 3.11 [H] Failover with `mosquitto_sub -t 'frio/#' -v`: primary off gives secondary at about 30 s; a blip < 30 s does not switch; `docker stop` broker for 2 min switches; hold-off 10 min respected then normal return; link-loss failover returns without hold-off; flapping primary stays; both off opens the AP still open after 10 min with backoff to 60 s; phone on AP pauses retries; reads continue offline with no publishes.
- [ ] 3.12 [H] Idle close: 3 s AP with no phone closes at 15 min and the STA resumes; a connected phone keeps it open until 15 min after leaving; empty-NVS AP and FALLBACK AP stay open past 15 min.

## Phase 4: Final verification

- [ ] 4.1 [H] 30 min AP soak: serial min free heap > 40 KB and no monotonic decline. Spec: Portal load.
- [ ] 4.2 [H] `mosquitto_sub -t '#' -v` for 2 min: only `frio/sucursal1/...`, status `online`; serial and topics contain no passwords. Spec: Topic audit, No leak.
- [ ] 4.3 Final `BUILD` with `--warnings all`: no warnings in new code; confirm `openspec/config.yaml` `build_command` matches the FQBN used.
