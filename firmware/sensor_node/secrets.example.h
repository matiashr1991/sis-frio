#pragma once
// OPTIONAL override. Copy this file to gitignored secrets.h only if you want a fixed device password.
// A fixed shared password is for MVP / own devices only. Customer devices MUST leave it undefined:
// they then get a random per-device password (generated once, stored in NVS, printed once on serial).
// The value is the WPA2 password of the config AP (8 to 63 characters, string literal) and is never printed.
// #define DEVICE_PASSWORD "8-to-63-chars"
