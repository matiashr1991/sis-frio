# Exploration: dashboard-pwa (cold-room sensor dashboard as installable PWA behind Cloudflare Tunnel)

## Current State

- Firmware (`firmware/sensor_node/sensor_node.ino` + tabs) publishes over MQTT every `PUBLISH_INTERVAL_MS` (10s): `frio/<site>/cam<N>/temp` (plain float string) for each DS18B20 discovered on the OneWire bus (`sensing.ino` already loops `sensors.getDeviceCount()` — multi-probe per site already works), plus retained `frio/<site>/status` (`online`/`offline` via LWT, set in `mqtt_link.ino`).
- `SITE_ID` is a single `constexpr` (`"sucursal1"`, in `sensor_node.ino`) — single-site/single-tenant hardcode, already explicitly deferred to a future change per `openspec/changes/device-connectivity/proposal.md` ("Out of Scope: Business config (site, cameras, thresholds) and MQTT config-topic contract").
- `camN` numbering is positional (`i + 1` from `DallasTemperature` discovery order), not a stable per-sensor hardware identity — a latent rough edge, not this change's problem.
- Infra (`infra/docker-compose.yml`, `infra/mosquitto/mosquitto.conf`): `eclipse-mosquitto:2` with a `:1883` anonymous listener (sensor node + dev clients) and a `:1884` authenticated listener used ONLY by the device's own provisioning wizard to test broker credentials — not a general app-facing port. `nodered/node-red` on `:1880` has zero flows/dashboards — confirmed unused; the decision to skip Node-RED dashboard for this change is respected and not reopened here.
- No time-series storage exists anywhere — Mosquitto keeps only the last retained value, no history.
- No Cloudflare Tunnel config exists anywhere in this repo — it's managed externally by the user; this change only needs to produce one local HTTP endpoint for them to point their existing tunnel at.

## Affected Areas

- `infra/docker-compose.yml` — add one new backend/dashboard service (container + named volume for SQLite).
- `infra/mosquitto/mosquitto.conf` — likely untouched; the new backend subscribes as an ordinary client on the existing anonymous `:1883` listener inside the Compose network (`mosquitto:1883`), same as the firmware.
- `firmware/sensor_node/*` — NOT modified; the dashboard is a passive MQTT subscriber only.
- New paths (naming deferred to design): a backend service dir (e.g. `services/dashboard-api/`) and a frontend PWA dir (e.g. `services/dashboard-pwa/`).

## Approaches

### 1. Backend stack

1. **Node.js + Fastify/Express** — single language shared with the frontend, mature `mqtt` npm client, trivial WS/SSE support. Pros: one language across the stack, huge ecosystem, small image, fast iteration. Cons: single-threaded (irrelevant at this scale). Effort: Low
2. **Python + FastAPI** — `paho-mqtt`, great DX, auto OpenAPI docs. Pros: clean async model. Cons: splits the stack into two languages for a solo dev, no real technical edge here. Effort: Low-Medium
3. **Go** — `paho.mqtt.golang`, static binary, minimal footprint. Pros: leanest runtime. Cons: highest ceremony for CRUD/JSON at this scale; a third language on top of Arduino C++ and JS. Effort: Medium

**Recommendation**: Node.js + Fastify (or Express) — matches the JS frontend, least ceremony, fits the existing "one small container per concern" Compose pattern.

### 2. Storage

1. **SQLite (`better-sqlite3`)** — file-based, one Docker named volume (same pattern as `mosquitto-data`/`nodered-data`). Pros: real persisted history across restarts, trivial backup, plenty fast for a handful of sensors at 10s cadence. Cons: no built-in retention/downsampling (irrelevant here). Effort: Low
2. **InfluxDB/TimescaleDB** — purpose-built TSDB. Pros: right tool at real scale. Cons: extra container + credentials + learning curve — overkill for <10 sensors. Effort: Medium-High
3. **In-memory ring buffer** — no persistence code. Pros: simplest. Cons: loses history on restart, breaks the "last N hours" nice-to-have, no future export path. Effort: Low but drops a stated MVP goal.

**Recommendation**: SQLite. Real history with zero extra ops; migrating the write path later (if multi-tenant scale demands it) only touches the ingestion insert, not the API.

### 3. Frontend/PWA

- `vite-plugin-pwa` works identically across React/Preact/Svelte/vanilla and auto-generates the manifest + Workbox service worker — the low-ceremony PWA answer regardless of framework.
- Framework pick (React vs Preact/Svelte) is a taste/familiarity call at this scale, not architecture — surfaced to the user in sdd-propose rather than forced here. A lightweight chart lib (uPlot) beats Chart.js in bundle size for the "last N hours" nice-to-have.
- Effort: Low regardless of framework.

### 4. Deployment shape behind the Cloudflare Tunnel

1. **Single combined service** — Node backend serves the built static PWA AND `/api` + `/ws` (or SSE) on one port; one tunnel ingress rule. Pros: fewest moving parts, one new container, matches existing pattern. Effort: Low
2. **Reverse proxy (nginx/Caddy)** in front of two containers. Pros: cleaner separation. Cons: extra container/config for no real benefit at this scale. Effort: Medium
3. **Cloudflare Tunnel multi-ingress** to two separate local services directly. Pros: avoids nginx. Cons: still two ports to manage, no simpler than option 1. Effort: Medium

**Recommendation**: Option 1. Only the dashboard gets a tunnel ingress rule — Mosquitto (`:1883` anonymous) and Node-RED must NOT be exposed through the tunnel (explicit risk).

### 5. MVP feature scope for v1

- Must have: current temp per site/cam, online/offline per site (retained `status` + LWT), live push (WS or SSE — Cloudflare Tunnel supports both; SSE is simpler infra for one-way push and worth considering over WS for v1).
- Nice-to-have: short historical chart (last N hours) from SQLite.
- Out of scope: alerting/thresholds/notifications — likely future work, probably paired with the anticipated multi-tenant MQTT contract change.

### 6. Auth for the dashboard

Reachable on the public internet even as a single-tenant demo — leaving it open is not recommended (business data + persistent PWA exposure).

1. **Cloudflare Access** in front of the tunnel hostname — zero app code, managed in Cloudflare Zero Trust. Cons: ties auth to an external policy; needs testing for installed-PWA session UX.
2. **App-level shared secret/simple login** (env var + session cookie) — fully in-app, better stepping stone to future multi-user SaaS auth.
3. **No auth** — not recommended once permanently public.

**Recommendation**: app-level shared-secret login by default (fits SaaS trajectory better); Cloudflare Access is a valid "even less code today" alternative to weigh in sdd-propose.

## Recommendation

Node.js + Fastify backend, subscribing over the existing anonymous `:1883` listener inside the Compose network, persisting to an embedded SQLite file (named volume, same pattern as existing services), serving REST+WS/SSE plus the built Vite+`vite-plugin-pwa` static frontend from one combined container, with a single new tunnel ingress rule pointing only at that container. Simple app-level shared-secret auth gates the dashboard. Mosquitto and Node-RED stay LAN-only, never tunneled.

## Multi-tenant retrofit risks (flagged, not solved here — explicitly out of scope)

- Subscribe with wildcards (`frio/+/+/temp`, `frio/+/status`) and key the SQLite schema by `(site, cam)` from day one — hardcoding `frio/sucursal1/#` or a single global "current reading" would be expensive to unwind later.
- Keep the auth/session layer decoupled from ingest/storage/query code, since single-shared-secret auth will need to become per-customer accounts later.
- Firmware's positional `camN` (discovery-order index, not a stable hardware ID) is a latent data-quality risk for historical continuity if probes are added/removed later — a footnote for whoever eventually designs the multi-tenant MQTT contract, not this change.

## Risks

- No Cloudflare Tunnel config exists in-repo; its ingress-rule setup is external — the user points their existing tunnel at the dashboard container's port at deploy time, not part of this proposal's scope.
- Exposing anything on the public tunnel demands care not to accidentally forward Mosquitto or Node-RED alongside the dashboard.
- `camN` is positional, not a stable per-sensor identity — acceptable for MVP, a known rough edge for future history integrity.
- SQLite is right at current scale; if this project moves to true multi-tenant SaaS with concurrent multi-writer needs, anticipate a future migration to Postgres/Timescale (not urgent now).

## Ready for Proposal

Yes — the option space is narrow and each axis has a clear low-effort recommendation: Node.js/Fastify + SQLite + Vite/vite-plugin-pwa + single combined service + app-level shared-secret auth. Alternatives flagged (Python/FastAPI, Cloudflare Access) are for the user to weigh in during proposal if preferred.
