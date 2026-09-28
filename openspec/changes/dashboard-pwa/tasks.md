# Tasks: Cold-Room Dashboard PWA

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,030 total (WU1 backend+compose+tests ~650, WU2 Preact PWA ~380) |
| 400-line budget risk | High |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: backend + compose + tests -> PR 2: Preact PWA |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
800-line budget risk: High

Rationale: total (~1,030 authored lines, excl. lockfile) exceeds both the generic 400-line guard and this project's 800-line single-PR budget. Splitting by work unit keeps each PR close to or under 800, but `single-pr` still requires an explicit exception or a chain-strategy decision before `sdd-apply` starts Phase 7+.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | MQTT ingest, SQLite store, auth, REST/SSE API, Compose service | PR 1 | `npm --prefix services/dashboard run test` | `docker compose up --build dashboard`; `mosquitto_pub -t frio/s1/c1/temp -m 4.2`; retained LWT offline; restart persistence; missing-password startup failure | Revert `services/dashboard/src/server/**`, `test/**`, and the `dashboard` service/volume in `infra/docker-compose.yml` |
| 2 | Preact PWA UI, login page, manifest/SW | PR 2 (bases on PR 1's API) | `npm --prefix services/dashboard run typecheck && npm --prefix services/dashboard run build` | `docker compose up --build dashboard`; manual PWA install over tunnel hostname; login/302 redirect flow | Revert `services/dashboard/src/web/**` and `public/icons/**`; backend stays functional standalone |

## Phase 1: Backend Scaffolding (WU1)

- [x] 1.1 Create `services/dashboard/{package.json,tsconfig.json,tsconfig.server.json,vite.config.ts,Dockerfile,.dockerignore}`.
- [x] 1.2 Create `src/server/config.ts`: fail fast if `DASHBOARD_PASSWORD` unset/empty; defaults for `MQTT_URL`, `DB_PATH`, `PORT`, `RETENTION_DAYS`, `STALE_AFTER_MS`.
- [x] 1.3 Create `src/server/store/db.ts`: `readings`/`site_status` schema (WAL, `user_version=1`), insert/upsert/snapshot/history queries.

## Phase 2: Ingest (telemetry-ingestion)

- [x] 2.1 Create `ingest/parse.ts` (topic regex `^[A-Za-z0-9_-]{1,64}$`, temp range [-55,125] rejecting -127, status enum) and `ingest/mqtt.ts` (subscribe `frio/+/+/temp`, `frio/+/status`; wire to store + hub).
- [x] 2.2 Write `test/parse.test.ts`: valid reading persisted; malformed payload discarded without crash; -127 rejected; unknown status dropped.

## Phase 3: Liveness & Retention (telemetry-ingestion)

- [x] 3.1 Create `live/hub.ts` + `live/stale.ts`: `lastTs` map seeded from `MAX(ts)`, 5s ticker, stale after `STALE_AFTER_MS`.
- [x] 3.2 Write `test/stale.test.ts`: cam stale while site stays online; fresh reading clears stale immediately.
- [x] 3.3 Create `retention.ts`: purge readings older than `RETENTION_DAYS` at boot and hourly.

## Phase 4: Access Control (dashboard-access-control)

- [x] 4.1 Create `auth/session.ts`: HMAC-signed `v1.<expMs>` cookie sign/verify; password check via sha256 + `timingSafeEqual`.
- [x] 4.2 Write `test/session.test.ts`: sign/verify round-trip; tampered/expired cookie rejected.
- [x] 4.3 Create `auth/plugin.ts`: `onRequest` hook — 401 on unauth `/api/*`, 302 `/login` on unauth HTML, public allowlist for login/assets/manifest/SW/icons.

## Phase 5: HTTP + SSE (live-dashboard, dashboard-access-control)

- [x] 5.1 Create `http/app.ts` + `src/server/main.ts`: register cookie/static/rate-limit/auth plugins; SIGTERM order MQTT -> Fastify -> DB.
- [x] 5.2 Create `http/routes.ts`: `POST /api/login` (5/min/IP), `POST /api/logout`, `GET /api/sites`, `GET /api/history` (24h default, 30d cap), `GET /healthz`.
- [x] 5.3 Create `http/sse.ts`: `GET /api/stream` emitting `snapshot`/`reading`/`status`/`stale`, 15s heartbeat.
- [x] 5.4 Write `test/store.test.ts`: parse->store->snapshot/history bucketing, purge cutoff, 401 without cookie.

## Phase 6: Compose & Config (closes WU1)

- [x] 6.1 Modify `infra/docker-compose.yml`: add `dashboard` service (port 8080, env, `dashboard-data` volume, `depends_on: [mosquitto]`).
- [x] 6.2 Create `infra/.env.example` (`DASHBOARD_PASSWORD=`); modify `.gitignore` for `infra/.env`, `services/dashboard/{node_modules,dist}`.
- [x] 6.3 Modify `openspec/config.yaml`: context, testing, `verify.test_command: "npm --prefix services/dashboard run check"` (leave firmware `build_command` untouched).
- [x] 6.4 Manual verify: `docker compose up --build dashboard`; confirm missing-password startup failure and `/healthz` returns `{mqtt:true, db:true}`. **Done** — both the Compose `${DASHBOARD_PASSWORD:?...}` guard and the app-level `config.ts` fail-fast were exercised directly; `/healthz` returned `{"mqtt":true,"db":true}`.

## Phase 7: Frontend Shell (WU2, live-dashboard)

- [x] 7.1 Create `web/login.html` + `login.ts`: password form posts to `/api/login`, shows 401, redirects on success.
- [x] 7.2 Create `web/index.html`, `main.tsx`, `app.tsx`, `store.ts`, `api.ts`: `EventSource('/api/stream')` wiring; 401 from `/api/sites` fallback redirects to `/login`.

## Phase 8: Components & PWA (live-dashboard)

- [x] 8.1 Create `components/SiteCard.tsx` + `CamTile.tsx`: temp, status, last-updated, stale indicator visually distinct from offline.
- [x] 8.2 Create `components/HistoryChart.tsx` (uPlot) fed by `/api/history` bucketed points.
- [x] 8.3 Add `public/icons/*`; configure `vite-plugin-pwa` (`generateSW`, `registerType: 'autoUpdate'`, precache shell, `navigateFallbackDenylist: [/^\/api/, /^\/login/]`), SW registered only from the authenticated app.

## Phase 9: Frontend Verification (closes WU2)

- [x] 9.1 Run `npm --prefix services/dashboard run typecheck` and `run build`; confirm `dist/web` has manifest, SW, hashed assets. **Done** — `dist/web` contains `manifest.webmanifest`, `sw.js`, `workbox-*.js`, and hashed `assets/*`.
- [x] 9.2 Manual E2E (done via `docker compose up --build` against real Mosquitto): live update confirmed (<1s via `mosquitto_pub`), offline via retained `frio/x/status=offline` confirmed independent of per-cam staleness, stale transition confirmed at ~35s, history survives `docker compose restart dashboard` confirmed, 401 (API) and 302 (`/`) without a cookie confirmed. **Not verifiable in this environment**: PWA install prompt over a real deployed tunnel hostname (requires an actual HTTPS tunnel + mobile browser, out of scope for this sandbox) — left for the user's own deployment smoke test.
