# Proposal: Device Connectivity (Layer 1 of 3)

## Intent

Installers cannot put a sensor node on a customer network today: WiFi credentials are compiled in (`secrets.h`), there is no fallback network, and any outage blocks the loop (WiFi 20 s + MQTT 15 s), which stalls sensing. Goal: a technician with a phone provisions primary WiFi, secondary WiFi and the MQTT broker, and each value is validated before it is saved. After that the node fails over on its own and never stops sensing.

## Scope

### In Scope
- Non-blocking firmware refactor (no `delay()` > 50 ms, async DS18B20, split into tabs).
- NVS settings (`Preferences`, namespace `conn`), one independent commit per wizard step.
- Protected config AP (WPA2) + captive portal + phone wizard: primary WiFi, then secondary WiFi, then MQTT (host, port, user, password). Each step is tested before it is saved.
- Custom failover state machine with primary return and AP reopen when both networks are down.
- Random per-device password generated on first boot (AP + menu), printed once on serial.
- BOOT/GPIO9 gestures after boot: 3 s = config mode, 10 s = factory reset of network config.
- Infra: optional authenticated Mosquitto listener (:1884 + password file) to test credential rejection.

### Out of Scope
- Business config (site, cameras, thresholds) and MQTT config-topic contract (change 2). `SITE_ID` stays constexpr `sucursal1`.
- Server alerts, dashboard, WhatsApp (change 3).
- Store-and-forward, OTA, TLS to broker.

## Capabilities

### New Capabilities
- `network-provisioning`: config AP, captive portal, wizard, test-before-save, NVS persistence, empty-NVS boot.
- `connectivity-failover`: link/broker health, primary/secondary switching, primary return, AP reopen, sensing continuity.
- `device-access-control`: per-device password lifecycle, BOOT gestures, factory reset.

### Modified Capabilities
None (no existing specs).

## Approach

Custom `WebServer` + `DNSServer` + `Preferences`. No WiFiManager, WiFiMulti or async server. The confirmed decisions (Engram `sdd/device-connectivity/decisions`) are binding:
- `WiFi.persistent(false)` and `setAutoReconnect(false)`.
- `POST /api/test` returns 202. The UI polls `/api/status` and tolerates the phone dropping when the AP switches channel.
- Failover: link lost > 30 s, or broker unreachable > 2 min. Return to primary after a 60 s light scan with 2 consecutive stable hits.
- MQTT test: separate client id `cfgtest-<chip>`, no Last Will, socket timeout ~4 s.

Build order inside the single PR: (1) refactor + settings + state machine; (2) portal + wizard + tests; (3) gestures + AP reopen + hardening.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `firmware/sensor_node/sensor_node.ino` | Modified | Non-blocking loop orchestrator |
| `firmware/sensor_node/*.ino/.h` tabs | New | settings, wifi_fsm, portal (+HTML), mqtt_link, sensing, button |
| `firmware/sensor_node/secrets.example.h` | Modified/Removed | No longer included by sketch |
| `infra/mosquitto/mosquitto.conf` (+ passwd) | Modified | Optional :1884 authenticated listener |
| `openspec/config.yaml` | Maybe | `PartitionScheme=min_spiffs` only if flash overflows |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Review size 550-700 of 800 lines | High | HTML minimal and inline; stop and re-forecast in tasks |
| Flash overflow (estimated, not measured) | Med | Compile after slice 2; `min_spiffs` fallback (USB reflash) |
| Phone drops on channel switch | High | 202 + polling + RAM result by test id |
| Failed test overwrites creds | Med | `persistent(false)` set before any `begin` |
| MQTT test stalls loop ~8 s | Med | 4 s timeout; FreeRTOS task only if measured |
| Open AP attack surface | Med | WPA2 random password, auth on every endpoint, never echo secrets |
| GPIO9 download-mode conflict | Low | Sample only after boot |

## Rollback Plan

Not a git repo. Before apply, copy the sketch to `firmware/sensor_node_legacy/sensor_node_legacy.ino` (the folder name must match the `.ino`). The user copies `secrets.h` manually because agents never touch it. To roll back, flash the legacy sketch. It ignores the `conn` NVS namespace. Infra: remove the :1884 listener block; :1883 is unchanged.

## Dependencies

- esp32 core 3.3.12 built-ins; PubSubClient 2.8; phone with 2.4 GHz.

## Success Criteria

- [ ] Compiles with `--warnings all` and fits app0 (or `min_spiffs`).
- [ ] WiFi failures (wrong password, missing or 5 GHz SSID, hidden SSID, other channel) are reported and nothing is persisted.
- [ ] Primary and secondary WiFi succeed. MQTT wrong host, closed port, firewalled port and bad credentials (:1884) are rejected; valid credentials succeed.
- [ ] Power cut mid-wizard leaves the prior config. Saved config survives reboot.
- [ ] Primary off: node is on secondary after ~30 s. Primary back: node returns. Both down: AP reopens and `frio/#` sensing logs continue.
- [ ] 3 s press opens the AP. 10 s press wipes the network config. Wrong password is rejected.
- [ ] Special characters and max lengths (32/63) work. 30-minute AP soak shows stable heap. iPhone hotspot works as secondary.
- [ ] No credentials on serial (lengths only) or on any MQTT topic.

## Proposal question round

Product decisions Q1-Q5 were confirmed before this phase. Assumptions for user review: BOOT is reachable in the enclosure; the label workflow captures the serial-printed password once; no remote AP-disable is needed in Layer 1.
