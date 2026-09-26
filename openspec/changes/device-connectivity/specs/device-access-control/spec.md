# Delta for device-access-control

Verification is manual (serial log / phone / button). TM = exploration test-matrix row.

## ADDED Requirements

### Requirement: Per-device random password

On first boot the device MUST generate one random password of at least 8 characters, store it in NVS, and print it once on serial for the label. It MUST NOT derive from the chip ID. There MUST be no second admin password.

#### Scenario: First boot
- GIVEN a device with empty NVS
- WHEN it boots
- THEN serial shows the password once, of at least 8 characters

#### Scenario: Later boots
- GIVEN the password was already generated
- WHEN the device reboots
- THEN the password is unchanged and is not printed again

### Requirement: One password protects AP and menu

The same password MUST be the WPA2 AP password and the HTTP-auth password for every config endpoint. Stored secrets MUST NOT be returned by any endpoint.

#### Scenario: Wrong password (TM admin)
- GIVEN the AP is joined
- WHEN a config endpoint is requested with a wrong or missing password
- THEN the response is 401 and no config data is returned

#### Scenario: Correct password
- GIVEN the AP is joined
- WHEN the correct password is supplied
- THEN the wizard loads

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
