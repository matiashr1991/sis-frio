# Proposal: Cold-Room Dashboard PWA

## Intent

Readings exist only as live MQTT messages. There is no history and nothing you can check from a phone outside the LAN. This change adds a small, authenticated, installable web dashboard that shows current temperature and site status, with a short history. It is the first user-facing step toward the SaaS vision.

## Scope

### In Scope
- A backend service (Node.js + Fastify) that subscribes to `mosquitto:1883` using wildcards `frio/+/+/temp` and `frio/+/status`.
- SQLite persistence (named volume), keyed by `(site, cam, ts)`, plus the last known status for each site.
- REST API plus live push (SSE preferred, WS acceptable).
- Vite + `vite-plugin-pwa` frontend: current temp per site/cam, online/offline, last-updated time, short history chart (nice-to-have).
- App-level shared-secret login (env var + session cookie), decoupled from the ingest and query code.
- One new service in `infra/docker-compose.yml`, exposing one HTTP port.

### Out of Scope
- Alerts, thresholds, notifications.
- Multi-tenant accounts and MQTT tenant/device-identity contract.
- Cloudflare Tunnel config (external, user-managed).
- Any `firmware/` change; Mosquitto/Node-RED config changes.

## Capabilities

### New Capabilities
- `telemetry-ingestion`: MQTT subscription, payload parsing, SQLite persistence, site status tracking.
- `live-dashboard`: query API, live push, installable PWA UI (current, status, history).
- `dashboard-access-control`: shared-secret login gating UI and API.

### Modified Capabilities
None

## Approach

One combined container (explore option 1): Fastify serves the built PWA, `/api`, and the live stream on a single port. The container is the only target for the tunnel ingress. Ingest, query, and auth are separate modules. This lets auth become per-customer later without touching ingest.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `firmware/` | None | Passive subscriber only |
| `infra/docker-compose.yml` | Modified | New service + SQLite volume |
| `services/dashboard/` (name set in design) | New | Backend + PWA source |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Mosquitto/Node-RED exposed via tunnel | Med | Document: tunnel points only at dashboard port |
| Weak shared secret on public URL | Med | Required env var, no default, secure cookie |
| Positional `camN` breaks history continuity | Low | Accepted; deferred to identity contract |
| Unbounded SQLite growth | Low | Configurable retention pruning |

## Rollback Plan

Remove the service and volume from `docker-compose.yml`, then run `docker compose up -d --remove-orphans`. Remove the tunnel ingress rule. Firmware and broker are unaffected.

## Dependencies

- Existing Mosquitto `:1883` listener; user's Cloudflare Tunnel (deploy time).

## Success Criteria

- [ ] Live readings for every published `(site, cam)` appear in the UI within about 10s.
- [ ] Site shows offline when LWT fires; history survives container restart.
- [ ] Unauthenticated requests to UI/API are rejected.
- [ ] PWA installs on a phone via the tunnel hostname.

## Proposal question round (assumptions pending user review)

1. Frontend framework: default is Preact (small bundle). Would you rather use React or Svelte?
2. Auth: default is app-level shared secret. Cloudflare Access means zero app code but ties login to Cloudflare.
3. History: default is a 24h chart and 30-day retention. What window matters for cold-chain audits?
4. Staleness: default is to mark a cam "stale" after 3 missed intervals (~30s), even while the site is online. Is that acceptable?
