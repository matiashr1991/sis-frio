# Delta for connectivity-failover

Verification is manual (serial state log / mosquitto_sub / phone). TM = exploration test-matrix row.

## ADDED Requirements

### Requirement: Deterministic connect behavior

Each connect attempt MUST time out after 15 s. WiFi auto-reconnect MUST be disabled so only the state machine drives connections.

#### Scenario: Attempt timeout
- GIVEN the target network is unreachable
- WHEN the device attempts to connect
- THEN the serial log shows the attempt abandoned at about 15 s and no background auto-reconnect

### Requirement: Failover to secondary

The device MUST switch to the secondary network when the WiFi link is lost for more than 30 s, OR the link is up but the broker is unreachable for more than 2 min.

#### Scenario: Primary off (TM failover)
- GIVEN the node is online on primary
- WHEN the primary router is powered off
- THEN the node connects to secondary after about 30 s and publishing resumes on `frio/#`

#### Scenario: Broker down, link up
- GIVEN the node is online on primary and the broker stops
- WHEN 2 min pass without a broker connection
- THEN the node switches to secondary

#### Scenario: Short blip
- GIVEN the node is online on primary
- WHEN the link drops for under 30 s and returns
- THEN no switch to secondary occurs

### Requirement: Return to primary without bouncing

While on secondary, the device MUST light-scan for primary every 60 s and MUST return only after 2 consecutive stable hits.

#### Scenario: Primary back (TM failover)
- GIVEN the node is on secondary
- WHEN primary is powered back on
- THEN after 2 consecutive positive scans the node returns to primary

#### Scenario: Flapping primary
- GIVEN the node is on secondary
- WHEN primary appears in one scan and vanishes in the next
- THEN the node stays on secondary

### Requirement: AP reopens when both networks are down

If both networks fail, the protected AP MUST open and stay open, with no timeout, until connectivity returns. STA retries MUST continue in the background with backoff from 5 s to 60 s, and MUST pause while a phone is connected to the AP. The AP MUST close once the STA is online.

#### Scenario: Both down (TM failover)
- GIVEN primary and secondary are both off
- WHEN failover attempts are exhausted
- THEN the AP opens and remains open after 10 min with STA retries backing off to 60 s

#### Scenario: Phone on AP
- GIVEN the AP is open and a phone is connected
- WHEN the retry interval elapses
- THEN no STA retry runs until the phone leaves

#### Scenario: Network returns
- GIVEN the AP is open and a network becomes reachable
- WHEN a STA retry succeeds
- THEN the AP closes and publishing resumes

### Requirement: Sensing never stops

The main loop MUST be non-blocking: no `delay()` over 50 ms and no blocking scans. DS18B20 reads MUST continue in every state, including while the portal is served or a test runs. Publishing MUST pause while offline.

#### Scenario: Sensing while offline
- GIVEN both networks are down and the AP is open
- WHEN 60 s pass
- THEN the serial log shows continued temperature reads and no publishes

#### Scenario: Portal load (TM AP-soak)
- GIVEN a phone is using the wizard
- WHEN sensing reads are logged
- THEN read intervals are not delayed by the portal, and a 30-minute AP soak shows stable `getMinFreeHeap()`

### Requirement: Publishing contract preserved

Topics MUST remain `frio/sucursal1/cam<N>/temp` (plain float) and retained `frio/sucursal1/status` with Last Will. Nothing outside `frio/#` MUST be published.

#### Scenario: Topic audit
- GIVEN the node is online
- WHEN `mosquitto_sub -t '#' -v` runs for 2 min
- THEN only `frio/sucursal1/...` topics appear and status is `online`

### Requirement: Hold-off after broker-triggered failover

When failover to the secondary was triggered by broker unreachability (not by WiFi link loss), the node MUST NOT probe or return to the primary network for 10 minutes, to prevent flapping.

#### Scenario: Hold-off respected
- GIVEN the node failed over to secondary because the broker was unreachable for more than 2 min
- WHEN the primary network becomes visible and stable within the next 10 min
- THEN the node stays on secondary until the 10 min have elapsed, then applies the normal return-to-primary rules

#### Scenario: Hold-off not applied to link-loss failover
- GIVEN the node failed over because the WiFi link was lost for more than 30 s
- WHEN the primary is seen stable on 2 consecutive probes
- THEN the node returns to primary without the 10 min hold-off
