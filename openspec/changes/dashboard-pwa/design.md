# Design: Cold-Room Dashboard PWA

## Technical Approach

This change adds one Node 24 + Fastify + TypeScript service in `services/dashboard/`. It does three jobs:

- It subscribes as a passive client to `mqtt://mosquitto:1883`, on the anonymous listener.
- It writes readings and site status to SQLite through `better-sqlite3`, stored in the named volume `dashboard-data`.
- It serves REST, SSE and the built Preact + `vite-plugin-pwa` app on one port, `:8080`.

Four modules are kept apart: `ingest`, `store`, `live` and `auth`. Only `http/app.ts` connects them. That keeps `auth` replaceable later with per-customer login without touching ingest. This change does not touch firmware or Mosquitto. The design implements the specs `telemetry-ingestion`, `live-dashboard` and `dashboard-access-control`.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Session | Stateless HMAC-signed cookie (`@fastify/cookie` signing). Value `v1.<expMs>`, key = `HMAC-SHA256("frio-session", DASHBOARD_PASSWORD)` | `@fastify/session` + a store | Needs no session table and no second secret. Rotating the password revokes every session. Individual logout cannot be revoked server-side (accepted). |
| Stale state | Derived from an in-memory `lastTs` map (seeded from the DB at boot) plus a 5 s ticker that emits transitions | Persisted stale column; a new topic | Stale is a function of `now - lastTs`, so it never needs storage. It survives restarts because the map is seeded from `MAX(ts)`. |
| Timestamps | Server receive time, epoch ms UTC | Device time | The payload is a bare float with no timestamp. The browser formats the local time. |
| Live push | SSE on `reply.hijack()` with an in-process `EventEmitter` hub | `@fastify/websocket`; an SSE plugin | Push is one-way. It needs no dependency, works over Cloudflare, and the browser `EventSource` reconnects on its own. |
| Retention | In-process `setInterval` every 1 h, plus once at boot | A cron container | This is one `DELETE`, and adding a container would give no benefit. |
| Static gating | HTML documents require a session. Hashed assets, the manifest, the SW and the icons are public. | Gate everything | The spec requires the UI to redirect to login. Browsers fetch the manifest without credentials, and the login page needs its own assets. |
| Tests | `node:test` + `tsx`, with `better-sqlite3` using `:memory:` | Vitest/Jest | Zero runner deps. Pure modules are easy to test. |
| Base image | `node:24-bookworm-slim`, multi-stage | Alpine | `better-sqlite3` prebuilds target glibc, so no toolchain is needed at runtime. |

## Data Flow

    sensor ─MQTT─> mosquitto:1883 ─(frio/+/+/temp, frio/+/status)─> ingest/parse
                                                                      │ valid
                                               store (SQLite) <───────┤
                                               live/hub (lastTs) <────┘
                                                  │ reading|status|stale events
    browser <─SSE /api/stream── http ── REST /api/sites, /api/history ── store
       └─ auth hook (cookie) guards /api/* and HTML documents

## SQLite Schema (`store/db.ts`, WAL, `synchronous=NORMAL`, `user_version=1`)

```sql
CREATE TABLE readings (
  site TEXT NOT NULL, cam TEXT NOT NULL, ts INTEGER NOT NULL, temp REAL NOT NULL,
  PRIMARY KEY (site, cam, ts)) WITHOUT ROWID;
CREATE INDEX readings_ts ON readings(ts);          -- purge
CREATE TABLE site_status (
  site TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('online','offline')),
  ts INTEGER NOT NULL);
```

Inserts use `INSERT OR IGNORE`. The current snapshot is taken with `SELECT site, cam, MAX(ts), temp … GROUP BY site, cam` (SQLite's bare-column rule for MAX). At the worst case of 10 cams × 30 days the table holds about 2.6 M rows.

## MQTT Ingest (`ingest/`)

- Client settings: id `frio-dashboard-<rand6>`, `clean: true`, QoS 0, `reconnectPeriod: 5000`. The client subscribes on every `connect`.
- `parse.ts` is pure. Segments must match `^[A-Za-z0-9_-]{1,64}$`.
  - For `frio/<site>/<cam>/temp`, the payload is parsed with `Number(trim)`. It is rejected if it is not finite or falls outside [-55, 125]. That rule drops the DS18B20 disconnect value `-127`.
  - For `frio/<site>/status`, only `online` and `offline` are accepted.
  - Anything else is logged at debug level and dropped.
- A temp message causes an insert, sets `hub.lastTs`, and emits `reading`. If the cam was stale, it also emits `stale:false`.
- A status message causes an upsert into `site_status` and emits `status`. The retained LWT arrives on subscribe and seeds the state.
- Stale rule: `stale = now - lastTs > STALE_AFTER_MS (30000)`. It is independent of `site_status`. The ticker runs every 5 s and emits `stale:true` once per transition, so the worst-case detection latency is 35 s.

## API (`http/`)

| Route | Auth | Contract |
|---|---|---|
| `GET /login` | public | Login page (Vite entry `login.html`, vanilla TS) |
| `POST /api/login` `{password}` | public, rate limit 5/min/IP | Returns 204 with Set-Cookie, 401, or 429 |
| `POST /api/logout` | session | Returns 204 and clears the cookie |
| `GET /api/sites` | session | Returns `Site[]` |
| `GET /api/history?site&cam&from&to&bucket` | session | Defaults to the last 24 h. The range is capped at 30 d. `bucket` in seconds is at least `ceil(range/2000)` and defaults to 60. |
| `GET /api/stream` | session | SSE |
| `GET /healthz` | public | Returns `{mqtt:boolean, db:boolean}` |
| `/`, other HTML routes | session | Returns `index.html`. Without a session, it returns **302 → `/login`**. |
| `/assets/*`, `/manifest.webmanifest`, `/sw.js`, `/workbox-*.js`, `/icons/*` | public | `@fastify/static` from `dist/web` |

- An `/api/*` request without a session gets 401.
- The password check compares `sha256` digests with `timingSafeEqual`.
- The cookie `frio_session` is set with `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30d`. It is always `Secure`, because browsers accept Secure cookies on `http://localhost`.
- The rate-limit key is `req.ip` (the real socket peer). `cf-connecting-ip` is a client-supplied header with no reverse proxy in front of `:8080` to authenticate it, so it is never trusted for rate-limiting.

## Interfaces / Contracts

```ts
type CamState = { cam: string; temp: number; ts: number; stale: boolean };
type Site = { site: string; status: 'online'|'offline'|'unknown'; statusTs: number|null; cams: CamState[] };
type HistoryResponse = { site: string; cam: string; bucket: number; points: [t: number, avg: number, min: number, max: number][] };
// SSE: "retry: 5000", heartbeat ": ping" every 15 s
// event: snapshot  data: Site[]                       (on connect)
// event: reading   data: {site,cam,temp,ts}
// event: status    data: {site,status,ts}
// event: stale     data: {site,cam,stale,lastTs}
```

On the frontend, Preact renders `SiteCard → CamTile` and a `HistoryChart` built with uPlot. `EventSource('/api/stream')` updates a signal store. If the stream errors, the app checks `/api/sites`, and a 401 there sends the browser to `/login`. The SW uses `generateSW` with `registerType: 'autoUpdate'` and precaches the shell only. It has no runtime caching for `/api` and uses `navigateFallbackDenylist: [/^\/api/, /^\/login/]`. The SW is registered only from the authenticated app.

## Config and Compose

`config.ts` fails fast if `DASHBOARD_PASSWORD` is unset or empty. The other settings and their defaults are `MQTT_URL=mqtt://mosquitto:1883`, `DB_PATH=/data/frio.db`, `PORT=8080`, `RETENTION_DAYS=30` and `STALE_AFTER_MS=30000`.

```yaml
  dashboard:
    build: ../services/dashboard
    restart: unless-stopped
    ports: ["8080:8080"]
    environment:
      - TZ=America/Argentina/Buenos_Aires
      - DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD:?set it in infra/.env}
      - MQTT_URL=mqtt://mosquitto:1883
      - DB_PATH=/data/frio.db
    volumes: [dashboard-data:/data]
    depends_on: [mosquitto]
# volumes: add dashboard-data:
```

The Dockerfile runs as the `node` user and creates `/data` owned by `node`, so the new named volume inherits that owner. The process handles SIGTERM by closing MQTT, then Fastify, then the DB.

## File Changes

| File | Action |
|---|---|
| `services/dashboard/{package.json,tsconfig.json,tsconfig.server.json,vite.config.ts,Dockerfile,.dockerignore}` | Create |
| `services/dashboard/src/server/{main,config}.ts`, `store/db.ts`, `ingest/{mqtt,parse}.ts`, `live/{hub,stale}.ts`, `retention.ts`, `auth/{session,plugin}.ts`, `http/{app,routes,sse}.ts` | Create |
| `services/dashboard/src/web/{index.html,login.html,login.ts,main.tsx,app.tsx,api.ts,store.ts}`, `components/*`, `public/icons/*` | Create |
| `services/dashboard/test/{parse,stale,session,store}.test.ts` | Create |
| `infra/docker-compose.yml` | Modify (add the service and the volume) |
| `infra/.env.example` | Create (`DASHBOARD_PASSWORD=`) |
| `.gitignore` | Modify (add `infra/.env`, `services/dashboard/{node_modules,dist}`) |
| `openspec/config.yaml` | Modify (context, testing, `verify.test_command`) |

## Testing Strategy / Verification

Scripts:

- `build` runs `tsc -p tsconfig.server.json && vite build` and writes `dist/server` and `dist/web`.
- `typecheck` checks the server and the web code.
- `test` runs `node --import tsx --test test/*.test.ts`.
- `check` runs `typecheck`, `test` and `build`.

| Layer | What | How |
|---|---|---|
| Unit | Topic/payload parsing, stale transitions, cookie sign/verify/expiry | `node:test` |
| Integration | Parse → store → snapshot/history bucketing; purge cutoff | `:memory:` DB |
| Manual E2E | Live update ≤ 10 s, offline via `mosquitto_pub -r -t frio/x/status -m offline`, stale after about 30 s, history kept after `docker compose restart dashboard`, 401/302 without a cookie, missing password stops startup, PWA install over the tunnel | `docker compose up --build` |

Changes to `openspec/config.yaml`: `verify.test_command: "npm --prefix services/dashboard run check"`. The firmware `build_command` stays as it is.

## Threat Matrix

N/A: there is no routing, shell, subprocess, VCS/PR automation, executable-file classification or process-integration boundary. HTTP exposure is covered under API.

## Migration / Rollout

There is no data to migrate. The schema is created when `user_version=0`. Before first `up`, create `infra/.env`. Point the tunnel only at `:8080`.

## Review Workload

The estimate is about 1,050 authored lines (server ~450, web ~350, tests ~150, config ~100), excluding the lockfile. That is over the 800-line budget. Suggested split: **(1)** backend + compose + tests, **(2)** Preact PWA.

## Open Questions

- None blocking.
