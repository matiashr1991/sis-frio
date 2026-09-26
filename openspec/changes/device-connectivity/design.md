# Design: Device Connectivity (Layer 1 of 3)

## Technical Approach

This design refactors `firmware/sensor_node` into a cooperative, non-blocking loop that runs over small `.ino` tabs sharing one header. The code uses only core built-ins (`WiFi`, `WebServer`, `DNSServer`, `Preferences`, plus the existing PubSubClient and DallasTemperature libraries). Network config lives in NVS namespace `conn`, with one atomic blob per wizard step. A two-axis model drives connectivity: a STA state machine that owns the station link, and an AP "reason mask" that decides whether the protected config AP is up. The portal runs each test in the background. When a test succeeds, the device commits that step. The UI then learns the result by polling, and polling survives the AP channel drop. The binding decisions come from Engram `sdd/device-connectivity/decisions` and the proposal. The scope is exactly change 1: no business config, no config topic, no alerts, no OTA/TLS/store-and-forward.

ESP32-C3 constraints: single core, so everything runs in `loopTask`. PubSubClient is not thread-safe. The WiFi event callbacks run in the event task and may only write `volatile` scalars that `loop()` consumes.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Module form | `.ino` tabs + one `app.h` (types, constants, prototypes) | `.h/.cpp` pairs; single file | Tabs share globals with the fewest lines. `app.h` avoids arduino-cli prototype errors with custom types. |
| Persistence unit | One NVS blob per step (`wifi1`, `wifi2`, `mqtt`) | One key per field | A single `putBytes` is power-cut atomic (the old entry is kept until the new one is complete). Per-field keys can leave an SSID/password mismatch. |
| Save semantics | Test-then-commit inside the same job, no `/api/save` | Separate save call | The phone may be off the AP when the test ends. There is no TOCTOU, and no validated secret waits in RAM. |
| Connectivity model | STA FSM + AP reason bitmask | One flat FSM | AP causes (provision, manual, fallback) are orthogonal to the link state, so a flat FSM would double the number of states. |
| WiFi control | `persistent(false)` before any WiFi call, `setAutoReconnect(false)`, event reason codes | WiFiMulti, stack auto-reconnect | Failed tests must not overwrite anything. Behavior stays deterministic, and failures can be classified. |
| MQTT test | Separate client in `loop()`, bounded blocking | FreeRTOS task from day 1 | Fewer lines and no concurrency. There are measurable criteria for escalating to a task (see §5). |
| Portal body format | `application/x-www-form-urlencoded` + `server.arg()` | JSON bodies | `WebServer` URL-decodes form args, so no JSON parser is needed. |
| Password | 12 chars from a 32-symbol alphabet via `esp_random()` with RF on | Chip-ID hash | 60 bits of entropy and nothing derivable from public source. |
| Broker auth test | Extra listener :1884 with `per_listener_settings true` | Switch :1883 to auth | Dev clients on :1883 keep working. |

## 1. Firmware Module Layout

| File | Responsibility | Public interface (in `app.h`) |
|---|---|---|
| `sensor_node.ino` | Includes, constexprs (`SITE_ID`, pins, timers), `setup()`, `loop()` scheduler, heap log | — |
| `app.h` | `WifiCred`, `MqttCfg`, `StaState`, `ApReason`, `TestJob`, extern globals, prototypes | — |
| `settings.ino` | NVS load/commit/erase, device password lifecycle | `settingsBegin()`, `commitWifi(slot,cred)`, `commitMqtt(cfg)`, `factoryReset()` |
| `wifi_fsm.ino` | STA state machine, event hook, primary probe | `wifiBegin()`, `wifiTick(now)`, `staOnline()`, `wifiLockForTest()/Release()` |
| `portal.ino` | softAP, `DNSServer`, `WebServer` routes, auth, test jobs | `apRequest(reason)`, `apClear(reason)`, `portalTick(now)` |
| `portal_html.h` | One minimal page + JS in `PROGMEM` (~5 KB) | `PAGE_HTML` |
| `mqtt_link.ino` | Live session and `cfgtest` client | `mqttTick(now)`, `mqttPublish(topic,payload)`, `mqttTest(cfg,&reason)` |
| `sensing.ino` | Async DS18B20 cycle | `sensingBegin()`, `sensingTick(now)` |
| `button.ino` | GPIO9 gestures | `buttonTick(now)` |

Access control has no tab of its own. The password lives in `settings.ino`, auth in `portal.ino`, and gestures in `button.ino`.

**Loop.** Every tick is non-blocking except the bounded MQTT connects (live and test, ≤ ~8 s):

```
loop(): now=millis(); buttonTick; wifiTick; portalTick (dns+http+job);
        mqttTick; sensingTick; heapLogTick(60 s)
```

`setup()` keeps one bounded CDC wait (`while(!Serial && millis()<2000)`) and nothing else. Sensing sets `setWaitForConversion(false)`, sends the request at T, and reads plus publishes at T+800 ms (12-bit needs 750 ms). The period stays 10 s. Scans happen only from `/api/scan` or the primary probe, always with `scanNetworks(true)`, and free their results with `scanDelete()`.

## 2. NVS Schema (`Preferences`, namespace `conn`)

| Key | Type | Content |
|---|---|---|
| `schema` | u8 | `1` |
| `wifi1` / `wifi2` | blob `WifiCred{char ssid[33]; char pass[64];}` | Primary / secondary |
| `mqtt` | blob `MqttCfg{char host[64]; uint16_t port; char user[65]; char pass[65];}` | Broker |
| `devpass` | string (12) | Device/AP password |

- Each wizard step writes one blob, and only after its test passes. A power cut therefore leaves either the old blob or the new blob. A missing `wifi1` at boot means provisioning mode.
- **Factory reset** (a confirmed decision) removes `wifi1`, `wifi2` and `mqtt`, then calls `ESP.restart()`. It **keeps** `devpass` and `schema`, so the printed label stays valid. After the reset, the device boots into `PROVISION` with the same AP/menu password.
- **Arduino WiFi NVS.** `WiFi.persistent(false)` is the first WiFi call in `wifiBegin()`. It puts the driver storage in RAM, so `begin()` never writes the stack namespace. Credentials left there by the legacy sketch become inert and are not erased.

## 3. WiFi / Failover State Machine

STA states: `IDLE`, `CONNECTING(net)`, `ONLINE(net)`, `RECOVERING(net)`, `BACKOFF`, `TESTING`. AP reason mask: `PROVISION | MANUAL | FALLBACK`. The AP is up if and only if the mask is non-zero.

```
 boot ─ no wifi1 ─> IDLE [AP:PROVISION] ──wifi1 committed──┐
   └── wifi1 ────────────────────────────────> CONNECTING(P) <──────────┐
                                                 │ GOT_IP   │ fail/15 s  │
                                                 v          v            │
     ┌──────────────── ONLINE(net) <──── CONNECTING(S) (if wifi2) ──fail─┤
     │ DISCONNECTED       │ broker down >2 min      │ no wifi2           │
     v                    └──> CONNECTING(other)    v                    │
 RECOVERING(net) ─ >30 s ─> CONNECTING(other)    BACKOFF [AP:FALLBACK] ──┘
     └─ GOT_IP ─> ONLINE      ONLINE(S) ─probe 2 hits─> CONNECTING(P)    5→60 s,
 any ─ portal test ─> TESTING ─ done ─> CONNECTING(P)                    paused if phone on AP
```

| Timer / rule | Value |
|---|---|
| Connect attempt | 15 s, then `WiFi.disconnect(false,false)` |
| Link-loss grace (`RECOVERING`, re-`begin` same net at 0 s and 15 s) | 30 s |
| Broker unreachable with link up (only if another net exists) | 2 min |
| Primary probe while `ONLINE(S)` (async scan, skipped if phone on AP) | every 60 s |
| Return condition | 2 consecutive hits with RSSI ≥ −80 dBm |
| Hold-off on primary return after a broker-triggered failover | 10 min (anti-flap) |
| `BACKOFF` sequence | 5, 10, 20, 40, 60, 60 … s. `softAPgetStationNum()>0` pauses it. |

Events: `onEvent(STA_DISCONNECTED)` stores `info.wifi_sta_disconnected.reason` in a `volatile uint8_t`, and `GOT_IP` sets a flag. Reason mapping: 201/210/211/212 → `no_ap` (the UI hints "2.4 GHz / hidden?"), 2/15/202/204 → `auth`, anything else → `link`. Leaving `BACKOFF` or `IDLE` for `ONLINE` clears `FALLBACK`. `WIFI_TX_POWER` is a constexpr (`WIFI_POWER_8_5dBm`) that is re-applied after every mode change.

## 4. Portal

The softAP is named `frio-<6 hex of efuse MAC>`, runs WPA2 with `devpass` on channel 1 and allows at most one station. `DNSServer` resolves `*` to 192.168.4.1. The AP runs as `WIFI_AP_STA`, so the live link stays up while the portal is open.

| Route | Auth | Behavior |
|---|---|---|
| `GET /` | yes | `PAGE_HTML` (wizard: W1 → W2 → MQTT → Finish) |
| `GET /api/scan` | yes | Starts an async scan or returns `{state, nets:[{ssid,rssi,ch,open}]}` |
| `POST /api/test` | yes | `step=w1\|w2\|mq` plus fields. Validates lengths (SSID 1–32, pass empty or 8–63, host 1–63, port 1–65535, user/pass ≤ 64). Returns **202** `{id}`, or 409 if a job is already running. |
| `GET /api/status[?id=]` | yes | `{id,state:running\|ok\|fail,reason,saved}` + `{w1:ssid,w2:ssid,mq:"host:port",mqUser:bool}`. Never returns passwords. |
| `POST /api/finish` | yes | Clears `MANUAL`/`PROVISION` (the latter only if `wifi1` exists) |
| `onNotFound` | no | 302 to `http://192.168.4.1/` (Android/iOS/Windows probes) |

- **Auth.** Every handler calls `server.authenticate("admin", devpass)`, and `requestAuthentication()` on failure.
- **TestJob.** One slot holds `{id, step, state, reason, t0, cred copy}`. The copy is wiped with `memset` when the job ends. The result is kept until the next test, or 10 min.
- **JS.** The page polls `/api/status` every 1 s and tolerates fetch failures for up to 45 s. After that it shows "rejoin frio-xxxx and reload"; a reload shows the last result.
- **Idle close.** `MANUAL` and `PROVISION` (with `wifi1` present) close after 15 min with zero stations. `FALLBACK` never times out.

## 5. MQTT Test-Before-Save

- Globals: `WiFiClient testNet; PubSubClient testMqtt(testNet); char g_testHost[64];`. The live session uses `char g_mqHost[64]`, because PubSubClient stores the host pointer. That buffer changes only while the session is disconnected.
- Sequence: `WiFi.hostByName` (→ `dns`) → `setServer(ip)` → `setSocketTimeout(4)` → `connect("cfgtest-<chip>", user|nullptr, pass|nullptr)` with no will → `disconnect(); testNet.stop()`. If the STA is not connected, the result is `no_wifi` immediately.
- Classification of `state()`: −2 → `refused` if it returned in < 1 s, else `unreachable`; −4 → `no_connack`; 1 → `protocol`; 2 → `client_id`; 3 → `unavailable`; 4 → `bad_credentials`; 5 → `not_authorized`.
- Worst-case stall: about 8 s with an IP host (3 s TCP + 4 s CONNACK), plus up to about 4 s for DNS. The live session uses the same `setSocketTimeout(4)`, with 5 s reconnect spacing. Client id `SITE_ID`, the LWT `offline` on `frio/<site>/status` (retained) and the `frio/<site>/cam<N>/temp` topics are unchanged.
- **Escalation to a one-shot FreeRTOS task** (6 KB stack, touching only `testMqtt` and the TestJob fields through a `volatile` done flag) happens only if a measured stall exceeds 10 s, or a stall causes a missed publish cycle or a dropped portal request.

## 6. Access Control

- **First boot.** `settingsBegin()` runs after `WiFi.mode()`, because the RNG is only truly random with RF on. If `devpass` is missing, it builds 12 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` using `esp_random() & 31`, stores them, and prints them once (`DEVICE PASSWORD: …`). Every other log line prints lengths only.
- **Button.** GPIO9 is read with `INPUT_PULLUP`, active LOW. It arms only after it has been read HIGH once after boot, so the strapping pin never affects the app. The stable state is debounced for 30 ms and polled every tick. The 3 s and 10 s thresholds are logged while the button is held, and the gesture is classified **on release**: ≥ 10 s runs `factoryReset()`, which wipes the network config only and keeps `devpass` (§2). ≥ 3 s runs `apRequest(MANUAL)`. A stall only delays classification; it cannot misfire a gesture.

## 7. Infra

`infra/mosquitto/mosquitto.conf`:

```
per_listener_settings true
listener 1883 0.0.0.0
allow_anonymous true
listener 1884 0.0.0.0
allow_anonymous false
password_file /mosquitto/config/passwd
persistence true
persistence_location /mosquitto/data/
log_dest stdout
```

`docker-compose.yml`: add port `"1884:1884"` and the volume `./mosquitto/passwd:/mosquitto/config/passwd:ro`. Create the password file first, from `infra/`:

`docker run --rm -v ${PWD}/mosquitto:/work eclipse-mosquitto:2 mosquitto_passwd -c -b /work/passwd frio-test <password>`

If the file is missing, mosquitto will not start. "Optional" means you can remove the second listener block, the port and the mount, and :1883 keeps working unchanged.

## 8. Flash / RAM Plan

- **Estimate.** WebServer 40–60 KB, DNSServer 5 KB, Preferences 5 KB, HTML 5 KB, softAP/DHCP 10–30 KB, for 65–105 KB in total. That gives about 1,035–1,075 KB of 1,310,720 B (79–82%).
- **Measure first.** At the start of slice 2, compile a spike that links `WebServer` + `DNSServer` with a single route. If the image is > 90% (1,179,648 B), switch to `esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=min_spiffs` (app 1,966,080 B) and update the `build_command`/`context` in `openspec/config.yaml`. The switch needs one USB flash. Both tables place NVS at 0x9000/0x5000, so `conn` survives; confirm this in the core's `partitions/*.csv`.
- **Heap.** Log `getFreeHeap`, `getMinFreeHeap` and `getMaxAllocHeap` at boot and every 60 s. Pass: min free heap > 40 KB and no monotonic decline over a 30-minute AP soak.

## 9. Build Order and Review Workload

| Slice | Content | Est. lines (+/−) |
|---|---|---|
| 1 | `app.h`, `sensor_node.ino` rewrite, `settings`, `wifi_fsm` (without AP), live `mqtt_link`, `sensing` | ~480 + 80 deleted |
| 2 | Flash spike, `portal`, `portal_html.h`, `mqttTest`, AP provisioning | ~330 |
| 3 | `button`, `FALLBACK` AP reopen, idle close, anti-flap, infra | ~110 |

Total ≈ 920 lines against the 800-line budget: **High risk**. This is a more detailed estimate than the proposal's 550–700. The legacy copy (~80 lines, verbatim) is excluded as a mechanical copy. `sdd-tasks` must re-forecast, and the orchestrator must obtain a `size:exception` or a slice split before apply.

## 10. Rollback and Verification

**Rollback.**
1. Before apply, copy the sketch verbatim to `firmware/sensor_node_legacy/sensor_node_legacy.ino`.
2. The user copies `secrets.h` into that folder manually.
3. Compile the legacy sketch once.
4. To roll back, flash the legacy sketch. It ignores `conn`.
5. For infra, drop the :1884 block, the port and the mount.

**Verification** (no test runner):

| Matrix item | Method | Pass |
|---|---|---|
| Build | `arduino-cli compile --warnings all` | No warnings in new code; size within §8 |
| WiFi fail (wrong pass, absent, 5 GHz, hidden, other channel) | Phone + serial | Correct reason; `wifi1` blob unchanged after reboot |
| WiFi success P/S; iPhone hotspot as S | Phone + serial | `saved:true`; survives reboot |
| MQTT wrong host / closed / firewalled / bad creds :1884 / OK | Phone + `mosquitto` log | `dns`/`refused`/`unreachable`/`bad_credentials`/`ok`; live session never kicked |
| Power cut mid-wizard | Unplug during a test | Previous config intact |
| Failover P off → S ~30 s; P back; both down | Router toggling + `mosquitto_sub -t '#' -v` | Transitions logged; AP reopens; readings keep logging on serial |
| Gestures 3 s / 10 s; wrong password | Button + phone | AP opens / network keys wiped; 401 returned |
| Special chars, lengths 32/63 | Phone | Exact round-trip |
| Soak 30 min AP; no secrets | Serial + `mosquitto_sub -t '#'` | Heap criteria met; nothing outside `frio/#`; lengths-only logs |

## File Changes

| File | Action |
|---|---|
| `firmware/sensor_node/sensor_node.ino` | Modify (orchestrator) |
| `firmware/sensor_node/{app.h,settings.ino,wifi_fsm.ino,portal.ino,portal_html.h,mqtt_link.ino,sensing.ino,button.ino}` | Create |
| `firmware/sensor_node/secrets.example.h` | Delete (no longer included; the user removes `secrets.h`) |
| `firmware/sensor_node_legacy/sensor_node_legacy.ino` | Create (verbatim copy) |
| `infra/mosquitto/mosquitto.conf`, `infra/docker-compose.yml` | Modify |
| `openspec/config.yaml` | Modify only if `min_spiffs` is needed |

## Threat Matrix

N/A: there is no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Device HTTP exposure is covered in §4 and §6.

## Open Questions

- [ ] If the one-time password print is missed, the only recovery is a full flash erase (`EraseFlash=all`), which regenerates it. Is that acceptable?
- [ ] Does the iOS captive mini-browser handle the Basic-auth prompt? Fallback: open `http://192.168.4.1` in Safari.
- [ ] Does TX power 8.5 dBm give acceptable RSSI on site, or should it default to full power?
- [x] Resolved (user-confirmed): the 15-minute idle close applies to MANUAL AP and to PROVISION AP only when wifi1 is already saved; the first-boot PROVISION AP with empty NVS and the FALLBACK AP never time out. The 10-minute anti-flap hold-off after a broker-triggered failover is accepted.
