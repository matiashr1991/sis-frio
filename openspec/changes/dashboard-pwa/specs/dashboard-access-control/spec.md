# Dashboard Access Control Specification

## Purpose

Gate the dashboard UI and API behind a single app-level shared password, decoupled from ingest/query modules, so the service is safe to expose through a public tunnel with no per-user account system.

## Requirements

### Requirement: Required Shared-Password Configuration

The backend MUST read the shared password from a required environment variable with no default value, and MUST fail to start if the variable is unset or empty.

#### Scenario: Missing password variable prevents startup

- GIVEN the shared-password environment variable is not set
- WHEN the dashboard container starts
- THEN the backend fails to start and logs a clear configuration error

#### Scenario: Configured password allows startup

- GIVEN the shared-password environment variable is set to a non-empty value
- WHEN the dashboard container starts
- THEN the backend starts normally and login becomes available

### Requirement: Password-Based Login

The backend MUST expose a login endpoint that accepts the shared password and, on success, issues a session cookie.

#### Scenario: Correct password grants a session

- GIVEN the configured shared password is `correct-value`
- WHEN a client submits `correct-value` to the login endpoint
- THEN the backend issues a session cookie and the client can access protected routes

#### Scenario: Incorrect password is rejected

- GIVEN the configured shared password is `correct-value`
- WHEN a client submits a different value to the login endpoint
- THEN the backend rejects the request with 401 and issues no session cookie

### Requirement: Session Enforcement on UI and API

The backend MUST reject any request to the dashboard UI or API that lacks a valid session cookie.

#### Scenario: Unauthenticated UI request is redirected

- GIVEN no valid session cookie is present
- WHEN a client requests the dashboard UI
- THEN the backend redirects to the login screen instead of serving the app

#### Scenario: Unauthenticated API request is rejected

- GIVEN no valid session cookie is present
- WHEN a client requests any `/api` endpoint
- THEN the backend responds with 401 and returns no protected data

### Requirement: Secure Session Cookie

The session cookie MUST be issued with `HttpOnly` and `Secure` attributes to reduce exposure when the dashboard is reachable via a public tunnel.

#### Scenario: Cookie attributes are set on login

- GIVEN a client logs in successfully
- WHEN the backend issues the session cookie
- THEN the cookie has `HttpOnly` and `Secure` attributes set

### Requirement: Auth Isolated from Ingest and Query Modules

Authentication logic MUST live in a module separate from ingest and query code, so login can later evolve to per-customer auth without touching ingest.

#### Scenario: Ingest continues independent of auth state

- GIVEN the shared password check fails for a UI/API request
- WHEN a valid MQTT telemetry message arrives concurrently
- THEN ingestion and persistence proceed unaffected by the rejected request
