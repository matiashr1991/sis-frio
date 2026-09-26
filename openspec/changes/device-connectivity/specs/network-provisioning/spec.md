# Delta for network-provisioning

Verification is manual (compile / serial log / mosquitto_sub / phone). TM = exploration test-matrix row.

## ADDED Requirements

### Requirement: Empty-NVS boot enters config mode

On boot with no saved network config, the device MUST start config mode only. It MUST NOT use embedded credentials, and the sketch MUST NOT include `secrets.h`. `SITE_ID` MUST remain constexpr `sucursal1`.

#### Scenario: Blank device (TM config-entry)
- GIVEN NVS namespace `conn` is empty
- WHEN the device boots
- THEN the protected AP opens and no STA connection is attempted

#### Scenario: Build has no secrets
- GIVEN the sketch source
- WHEN it is compiled with `--warnings all` without `secrets.h` present
- THEN the build succeeds and MQTT topics still use `sucursal1`

### Requirement: Protected config AP and captive portal

Config mode MUST serve a WPA2 AP (password per device-access-control) and a phone-usable portal. DNS wildcard and redirect MUST send captive-portal probes to the wizard.

#### Scenario: Captive popup
- GIVEN config mode is active
- WHEN a phone joins the AP with the correct password
- THEN the OS captive popup or `192.168.4.1` shows the wizard

### Requirement: Test-before-save wizard

The wizard MUST run in order: primary WiFi, secondary WiFi, MQTT broker (host, port, user, password). A step MUST persist only after its own test passes. A failed step MUST be repeatable. Earlier passed steps MUST stay saved and working.

#### Scenario: Failed step not saved (TM WiFi-fail)
- GIVEN primary WiFi passed and secondary is being tested
- WHEN the secondary test fails
- THEN nothing is stored for secondary and the step is offered again

#### Scenario: Partial wizard (TM persistence)
- GIVEN primary WiFi passed, then the device reboots before further steps
- WHEN it boots
- THEN it uses the saved primary network

#### Scenario: Power cut mid-step
- GIVEN a step test is running
- WHEN power is cut and restored
- THEN nothing is persisted for that step and earlier steps are intact

### Requirement: Failed tests never overwrite stored credentials

WiFi tests MUST run with `WiFi.persistent(false)` set before any connect call, so stored credentials stay unchanged after any failed test.

#### Scenario: Wrong password retest
- GIVEN valid primary credentials are saved
- WHEN a test with a wrong password fails
- THEN after reboot the device still joins the saved primary

### Requirement: WiFi test verdicts

A WiFi test MUST succeed only when an IP is obtained within 15 s. Failures MUST be classified as SSID not found, authentication failure, or timeout from disconnect reason codes.

#### Scenario: Failure classes (TM WiFi-fail)
- GIVEN wrong password, absent SSID, 5 GHz-only SSID, and hidden SSID cases
- WHEN each is tested
- THEN the result reports auth failure, or SSID not found, or timeout, and the serial log shows the reason code

#### Scenario: Success (TM WiFi-success)
- GIVEN a reachable 2.4 GHz network including an iPhone hotspot
- WHEN tested with correct credentials
- THEN the result is success and the step is saved

### Requirement: MQTT test verdicts

An MQTT test MUST use a client id other than `SITE_ID` (`cfgtest-<chip>`), no Last Will, and a socket timeout of about 4 s. It MUST report the failure class: network, bad credentials, or not authorized. Success MUST save host, port, user, and password.

#### Scenario: Live session untouched
- GIVEN the node is online as `sucursal1`
- WHEN an MQTT test runs
- THEN the live session is not kicked and no `frio/sucursal1/status` change occurs

#### Scenario: Failure classes (TM MQTT)
- GIVEN wrong host, closed port, firewalled port, and wrong credentials on :1884
- WHEN each is tested
- THEN network failures report network, and bad credentials report bad credentials or not authorized

### Requirement: Non-blocking test API

`POST /api/test` MUST return immediately (202). The UI MUST poll `/api/status` about once per second and tolerate the phone dropping for 30-40 s. The result MUST be retained by test id so the UI resumes.

#### Scenario: Channel-switch drop
- GIVEN a test is running and the AP changes channel
- WHEN the phone reconnects after 30-40 s
- THEN the UI shows the retained result without a re-test

### Requirement: Input handling and secret hygiene

Form fields MUST be URL-decoded. SSID up to 32 and password up to 63 characters MUST work. Stored passwords MUST NOT be echoed to the UI. Serial output MUST log credential lengths only, and no credential MUST appear on any MQTT topic.

#### Scenario: Special characters and limits (TM input)
- GIVEN an SSID of 32 chars and a password of 63 chars containing `&%+ "`
- WHEN the step is tested
- THEN the values are used exactly as typed

#### Scenario: No leak
- GIVEN a completed wizard
- WHEN the serial log and `mosquitto_sub -t '#' -v` are inspected
- THEN no password appears in either

### Requirement: Authenticated test listener

Infra MUST provide an optional Mosquitto listener on :1884 with a password file so credential rejection is testable. Listener :1883 MUST remain unchanged.

#### Scenario: Rejection
- GIVEN the :1884 listener is running
- WHEN a client connects with wrong credentials
- THEN the broker refuses it, while :1883 behavior is unchanged
