# Telemetry Ingestion Specification

## Purpose

Subscribe to the existing Mosquitto broker, persist temperature readings and site status to SQLite, and derive per-`(site, cam)` liveness so the dashboard can show current values and staleness without touching firmware or broker config.

## Requirements

### Requirement: MQTT Wildcard Subscription

The backend MUST subscribe to `mosquitto:1883` using wildcard topics `frio/+/+/temp` (plain float payload) and `frio/+/status` (retained online/offline via Last Will).

#### Scenario: New site/cam publishes a reading

- GIVEN the backend is connected to Mosquitto
- WHEN a message arrives on `frio/site1/cam2/temp` with a float payload
- THEN the backend accepts it without prior registration of `site1`/`cam2`

#### Scenario: Site status LWT fires

- GIVEN a site's MQTT client disconnects uncleanly
- WHEN the broker publishes the retained Last Will to `frio/site1/status` as `offline`
- THEN the backend records `site1` as offline

### Requirement: Reading Persistence

The backend MUST persist each valid temperature reading to SQLite, keyed by `(site, cam, ts)`.

#### Scenario: Valid reading persisted

- GIVEN a message on `frio/site1/cam1/temp` with payload `4.2`
- WHEN the backend processes it
- THEN a row `(site1, cam1, ts, 4.2)` is written to SQLite

#### Scenario: Malformed payload is discarded

- GIVEN a message on `frio/site1/cam1/temp` with a non-numeric payload
- WHEN the backend processes it
- THEN the backend discards the message, logs it, and MUST NOT crash or persist a row

### Requirement: Site Status Tracking

The backend MUST maintain the last known online/offline status per site, sourced from the retained `frio/<site>/status` topic.

#### Scenario: Status query reflects last retained message

- GIVEN `frio/site1/status` last published `online`
- WHEN any consumer queries site1's status
- THEN the backend reports `online`

### Requirement: Per-Reading Staleness

The backend MUST mark a `(site, cam)` pair as "stale" after approximately 30 seconds (3 missed publish intervals, given a 10s publish interval) without a new reading, independent of that site's online/offline status.

#### Scenario: Cam goes stale while site stays online

- GIVEN `site1/cam1` last reported a reading 35 seconds ago
- AND `site1` status is `online`
- WHEN the staleness check runs
- THEN `site1/cam1` is reported as stale while site1 remains online

#### Scenario: Fresh reading clears staleness

- GIVEN `site1/cam1` is marked stale
- WHEN a new reading arrives for `site1/cam1`
- THEN the stale flag clears immediately

### Requirement: 30-Day Retention

The backend MUST retain readings for 30 days and purge older readings from SQLite.

#### Scenario: Old readings are purged

- GIVEN a reading older than 30 days exists in SQLite
- WHEN the retention purge runs
- THEN that reading is deleted and readings within 30 days are unaffected

### Requirement: Persistence Survives Restart

Readings and last known status MUST survive a container restart via a named SQLite volume.

#### Scenario: Restart preserves history

- GIVEN readings exist in the SQLite volume
- WHEN the dashboard container restarts
- THEN previously persisted readings and last known status are still queryable
