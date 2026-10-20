# sis-frio

Cold-room temperature monitoring. ESP32 sensor nodes read DS18B20 probes in each cold room (`cam`), publish the readings over MQTT, and a self-hosted dashboard stores them, shows them live on any phone or browser, and sends Telegram alerts when a room leaves its allowed range or a site goes offline.

```text
 ┌──────────────┐  MQTT (TLS)   ┌───────────┐  subscribe   ┌──────────────────────────┐  HTTPS/SSE  ┌──────────┐
 │ ESP32 node   │ ────────────▶ │ Mosquitto │ ───────────▶ │ dashboard (Node/Fastify) │ ──────────▶ │ PWA      │
 │ + DS18B20 x N│               │  broker   │              │ SQLite · alerts · API    │             │ (Preact) │
 └──────────────┘               └───────────┘              └────────────┬─────────────┘             └──────────┘
                                                                        │ alerts
                                                                        ▼
                                                                    Telegram
```

## Quick start (local)

Requirements: Docker with Compose. Node.js 24+ only if you want to run the dashboard outside Docker.

1. Create the env file and set the dashboard password:
   ```bash
   cp infra/.env.example infra/.env   # then set DASHBOARD_PASSWORD
   ```
2. Create the Mosquitto password file (required by the authenticated `:1884` listener, or Mosquitto won't start). From `infra/`:
   ```bash
   docker run --rm -v ${PWD}/mosquitto:/work eclipse-mosquitto:2 mosquitto_passwd -c -b /work/passwd frio-test <password>
   ```
3. Start the stack:
   ```bash
   cd infra && docker compose up -d --build
   ```
4. Open `http://localhost:8080`, log in with `DASHBOARD_PASSWORD`, and publish a test reading:
   ```bash
   docker compose exec mosquitto mosquitto_pub -t frio/sucursal1/cam1/temp -m 3.5
   ```
   The site and its room appear on the dashboard in real time.

## Repository layout

| Path | What it is |
|------|------------|
| `firmware/sensor_node/` | Production firmware for the sensor node (Arduino / ESP32). |
| `firmware/sensor_node_legacy/` | First prototype: fixed WiFi/MQTT credentials from `secrets.h`. Kept for reference. |
| `firmware/test_sensor/` | Minimal sketch that only reads the DS18B20 bus. Useful to validate wiring. |
| `firmware/diag_bus/` | 1-Wire bus diagnostic (pull-up and presence pulse check on GPIO4). |
| `services/dashboard/` | Backend (ingest, storage, API, alerts) and PWA frontend. |
| `infra/` | Docker Compose stack for local development: Mosquitto, dashboard, Node-RED. |

## How it works

### 1. Sensor node (firmware)

- **Hardware:** an ESP32 board (developed on an ESP32-C3, BOOT button on GPIO9) with one or more DS18B20 probes on a single 1-Wire bus on **GPIO4**, with a 4.7 kΩ pull-up to 3.3 V. Each probe found on the bus becomes one room: `cam1`, `cam2`, ...
- **Sensing:** non-blocking cycle every 10 s (12-bit conversion, ~750 ms). If no probe is found at boot, the bus is rescanned every cycle.
- **Provisioning from a phone:** on first boot (or on demand) the node opens a WPA2 access point `frio-XXXXXX` with a captive portal (it opens automatically when the phone joins). From there you configure a **primary and a secondary WiFi** and the **MQTT broker**; each step is tested before it is saved. Settings live in NVS.
- **Device password:** the AP password is random per device (generated once, stored in NVS, printed once on the serial monitor). A fixed password can be set in `secrets.h` (copy `secrets.example.h`), but only for your own devices.
- **Failover:** a non-blocking WiFi state machine switches to the secondary network when the primary link drops (30 s grace) or the broker is unreachable (2 min), probes the primary every minute, and returns when its signal is good enough. Reconnects use exponential backoff (5 s – 60 s).
- **BOOT button gestures:**

  | Hold | Action |
  |------|--------|
  | ≥ 3 s | Open the config AP manually (closes after 15 min without a phone connected). |
  | ≥ 10 s | Factory reset of the network config (the device password is kept). |

- **MQTT:** always over TLS (port 8883), validating the broker against the CA bundle in `mqtt_ca.h`.

### 2. MQTT contract

| Topic | Payload | Notes |
|-------|---------|-------|
| `frio/<site>/cam<N>/temp` | Plain float, e.g. `3.50` | °C. Readings outside -55 … 125 are dropped. |
| `frio/<site>/status` | `online` \| `offline` | Retained. `offline` is the MQTT Last Will. |
| `frio/<site>/net` | `primary` \| `secondary` | Retained. Which WiFi network carries the session. |

`<site>` and `<cam>` must match `[A-Za-z0-9_-]{1,64}`. The site id is set by `SITE_ID` in `sensor_node.ino`.

### 3. Dashboard service

- **Ingest:** subscribes to the three topics above, validates every message, and drops anything malformed without crashing.
- **Storage:** SQLite (`better-sqlite3`). Readings older than `RETENTION_DAYS` are purged.
- **Live updates:** server-sent events (`/api/stream`). A room with no reading for `STALE_AFTER_MS` is shown as stale.
- **Alerts:** per-room min/max thresholds configured from the dashboard. An alert opens once when a reading crosses a threshold (or a site goes offline) and closes when it returns to normal; both events notify Telegram.
- **Access:** single shared password, session cookie, rate-limited login.
- **Frontend:** installable PWA built with Preact + signals, live room tiles, and history charts with uPlot.

#### API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/login`, `/api/logout` | Session handling. |
| `GET` | `/api/sites` | Sites, rooms, latest readings and status. |
| `GET` | `/api/history` | Reading history for the charts. |
| `GET` | `/api/stream` | Live updates (SSE). |
| `PUT` | `/api/config/:site/:cam` | Room label and min/max thresholds. |
| `GET` | `/healthz` | Health check. |

#### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PASSWORD` | — (required) | Login password. |
| `MQTT_URL` | `mqtt://mosquitto:1883` | Broker URL. |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | empty | Broker credentials, if needed. |
| `DB_PATH` | `/data/frio.db` | SQLite file. |
| `PORT` | `8080` | HTTP port. |
| `RETENTION_DAYS` | `30` | Days of readings kept. |
| `STALE_AFTER_MS` | `30000` | Time without data before a room is marked stale. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | empty | Enable Telegram alerts when both are set. |

### 4. Local infrastructure

`infra/docker-compose.yml` runs:

| Service | Port | Notes |
|---------|------|-------|
| Mosquitto | `1883` | Anonymous, for development only. |
| Mosquitto | `1884` | Requires a user from `infra/mosquitto/passwd`. |
| Dashboard | `8080` | Built from `services/dashboard`. |
| Node-RED | `1880` | Optional, for flow experiments. |

> The local broker has no TLS. Production firmware connects with TLS on port 8883, so point it to a broker with a TLS listener (or adapt the firmware) when testing against `infra/`.

## Development

### Dashboard

```bash
cd services/dashboard
npm install
npm run dev:server   # backend with watch (needs DASHBOARD_PASSWORD and a reachable MQTT_URL)
npm run dev:web      # Vite dev server for the PWA
npm run check        # typecheck + tests + build
```

Tests use the built-in Node test runner (`npm test`).

### Firmware

1. Install the Arduino IDE (or `arduino-cli`) with the **esp32** board package.
2. Install the libraries: `OneWire`, `DallasTemperature`, `PubSubClient`.
3. Optional: copy `firmware/sensor_node/secrets.example.h` to `secrets.h` (gitignored) to set a fixed device password.
4. Adjust `SITE_ID` and the timing constants in `sensor_node.ino` if needed.
5. Flash `firmware/sensor_node/`, open the serial monitor at 115200 baud, and note the device password.
6. Connect your phone to `frio-XXXXXX` and complete the setup in the portal.

If no probes are detected, flash `firmware/test_sensor/` or `firmware/diag_bus/` to check the wiring.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Firmware | ESP32, Arduino framework, OneWire, DallasTemperature, PubSubClient, WiFiClientSecure |
| Messaging | MQTT, Eclipse Mosquitto 2 |
| Backend | Node.js 24, TypeScript, Fastify 5, mqtt.js, better-sqlite3 |
| Frontend | Preact, @preact/signals, uPlot, Vite, vite-plugin-pwa |
| Notifications | Telegram Bot API |
| Infra | Docker, Docker Compose |
