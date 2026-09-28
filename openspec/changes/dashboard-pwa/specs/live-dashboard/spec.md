# Live Dashboard Specification

## Purpose

Give an authenticated user a REST + live-push view of current readings, per-site/cam status, and a 24h history chart, delivered as an installable Preact PWA served from one container/port.

## Requirements

### Requirement: Current Reading Query API

The backend MUST expose a REST endpoint returning, for every known `(site, cam)`, the latest reading value, timestamp, and derived status (online/offline/stale).

#### Scenario: Query returns latest state

- GIVEN readings exist for `site1/cam1` and `site1` is online
- WHEN an authenticated client requests the current-readings endpoint
- THEN the response includes `site1/cam1`'s latest value, timestamp, and status

### Requirement: Live Push Updates

The backend MUST push new readings and status changes to connected clients via Server-Sent Events (SSE) so the UI reflects new data without polling.

#### Scenario: New reading is pushed live

- GIVEN a client is subscribed to the SSE stream
- WHEN a new reading is persisted for `site1/cam1`
- THEN the client receives an event with the updated value within about 10 seconds

#### Scenario: Status change is pushed live

- GIVEN a client is subscribed to the SSE stream
- WHEN `site1`'s status changes from `online` to `offline`
- THEN the client receives a status-change event for `site1`

### Requirement: 24-Hour History API

The backend MUST expose a REST endpoint returning the last 24 hours of readings for a given `(site, cam)`, drawn from the 30-day SQLite retention window, for charting.

#### Scenario: History request returns 24h window

- GIVEN `site1/cam1` has readings older than 24h and within the last 24h
- WHEN an authenticated client requests its history
- THEN only readings from the last 24 hours are returned

### Requirement: Dashboard UI

The Preact frontend MUST display, per site/cam: current temperature, online/offline/stale status, last-updated time, and a 24h history chart.

#### Scenario: Stale cam is visually distinct from offline site

- GIVEN `site1` is online but `site1/cam1` is stale
- WHEN the UI renders `site1`
- THEN `site1/cam1` shows a stale indicator distinct from an offline-site indicator

### Requirement: PWA Installability

The frontend MUST ship a web app manifest and service worker so it can be installed on a phone home screen when accessed over the deployed tunnel hostname.

#### Scenario: Install prompt available

- GIVEN a user opens the dashboard over HTTPS via the tunnel hostname on a mobile browser
- WHEN the manifest and service worker are served correctly
- THEN the browser offers to install the PWA

### Requirement: API and UI Require Authentication

Every dashboard UI route and API endpoint MUST require an authenticated session, per the `dashboard-access-control` capability.

#### Scenario: Unauthenticated API request rejected

- GIVEN no valid session cookie is present
- WHEN a client requests the current-readings or history API
- THEN the backend responds with 401 and returns no reading data
