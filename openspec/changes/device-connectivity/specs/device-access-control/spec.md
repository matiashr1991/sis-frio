# Delta for device-access-control

Verification is manual (serial log / phone / button). TM = exploration test-matrix row.

## ADDED Requirements

### Requirement: Device password source

The device password MUST be at least 8 characters and MUST NOT derive from the chip ID. If the build defines `DEVICE_PASSWORD` (gitignored `secrets.h`), the device MUST use that value on every boot and MUST NOT print it. Otherwise, on first boot the device MUST generate one random password, store it in NVS, and print it once on serial for the label. There MUST be no second admin password. A fixed shared password is intended for MVP/own devices only; customer devices MUST use the random per-device password.

#### Scenario: First boot (random)
- GIVEN `DEVICE_PASSWORD` is not defined and NVS is empty
- WHEN the device boots
- THEN serial shows the password once, of at least 8 characters

#### Scenario: Later boots (random)
- GIVEN the random password was already generated
- WHEN the device reboots
- THEN the password is unchanged and is not printed again

#### Scenario: Fixed password
- GIVEN the build defines `DEVICE_PASSWORD`
- WHEN the device boots
- THEN the AP uses that password and serial does not print it

### Requirement: AP password protects the menu

The device password MUST be the WPA2 AP password, and the config portal MUST be reachable only through that AP (no HTTP-level authentication, since captive-portal browsers cannot answer a Basic-auth prompt). The portal server MUST NOT listen while the AP is down. Stored secrets MUST NOT be returned by any endpoint.

#### Scenario: Wrong AP password
- GIVEN a phone tries to join the AP with a wrong password
- WHEN association is attempted
- THEN the phone is rejected and no config page is reachable

#### Scenario: Correct password
- GIVEN the phone joined the AP with the correct password
- WHEN it opens the captive popup or http://192.168.4.1
- THEN the wizard loads without a login prompt

#### Scenario: No secrets returned
- GIVEN credentials are saved
- WHEN any endpoint is requested
- THEN no stored password is present in the response

### Requirement: BOOT long press enters config mode

A press of 3 s on BOOT (GPIO9) sampled after boot MUST enter config mode without erasing any settings. Holding BOOT during reset MUST NOT be part of the design.

#### Scenario: 3 s press (TM config-entry)
- GIVEN the node is online with saved config
- WHEN BOOT is held 3 s while running
- THEN the AP opens and saved config remains intact after reboot

#### Scenario: Short press
- GIVEN the node is running
- WHEN BOOT is pressed for under 3 s
- THEN nothing changes

### Requirement: BOOT 10 s factory reset

A press of 10 s MUST erase the network config (WiFi, MQTT) and return to config mode. It MUST keep the device password so the label stays valid.

#### Scenario: 10 s press
- GIVEN the node has saved config
- WHEN BOOT is held 10 s
- THEN the network config is wiped, the AP opens, and the next boot enters config mode via empty-NVS rules

#### Scenario: Password kept
- GIVEN a factory reset was done
- WHEN the AP opens
- THEN the label password still joins the AP

### Requirement: Config AP idle close

A config AP opened by the 3 s BOOT press on a node that already has saved network config MUST close after 15 minutes with no client connected, and the node MUST resume normal STA operation with that config. The AP MUST NOT time out when it was opened by first boot with empty NVS (nothing to fall back to) or as the fallback because both networks are down.

#### Scenario: Idle close
- GIVEN the config AP was opened by a 3 s BOOT press and no phone connects
- WHEN 15 min elapse
- THEN the AP closes and the node continues STA operation with its saved config

#### Scenario: Client keeps the AP alive
- GIVEN a phone is connected to the config AP
- WHEN 15 min elapse since the AP opened
- THEN the AP stays open until the phone has been gone for 15 min

#### Scenario: First-boot AP never closes
- GIVEN NVS is empty and the provisioning AP is open
- WHEN more than 15 min elapse with no client
- THEN the AP is still open

#### Scenario: Fallback AP never closes
- GIVEN both networks are down and the fallback AP is open
- WHEN more than 15 min elapse with no client
- THEN the AP is still open
