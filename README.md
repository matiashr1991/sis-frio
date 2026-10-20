# sis-frio

Monitoreo de temperatura de cámaras de frío. Nodos ESP32 leen sondas DS18B20 en cada cámara (`cam`) y publican las lecturas por MQTT. Un dashboard autoalojado las guarda, las muestra en vivo desde cualquier celular o navegador y envía alertas por Telegram cuando una cámara sale de su rango permitido o un sitio queda sin conexión.

```text
 ┌──────────────┐  MQTT (TLS)   ┌───────────┐  subscribe   ┌──────────────────────────┐  HTTPS/SSE  ┌──────────┐
 │ Nodo ESP32   │ ────────────▶ │ Mosquitto │ ───────────▶ │ dashboard (Node/Fastify) │ ──────────▶ │ PWA      │
 │ + DS18B20 x N│               │  broker   │              │ SQLite · alertas · API   │             │ (Preact) │
 └──────────────┘               └───────────┘              └────────────┬─────────────┘             └──────────┘
                                                                        │ alertas
                                                                        ▼
                                                                    Telegram
```

## Inicio rápido (local)

Requisitos: Docker con Compose. Node.js 24+ solo si se quiere correr el dashboard fuera de Docker.

1. Crear el archivo de entorno y definir la contraseña del dashboard:
   ```bash
   cp infra/.env.example infra/.env   # luego completar DASHBOARD_PASSWORD
   ```
2. Crear el archivo de contraseñas de Mosquitto (lo requiere el listener autenticado `:1884`; sin él Mosquitto no arranca). Desde `infra/`:
   ```bash
   docker run --rm -v ${PWD}/mosquitto:/work eclipse-mosquitto:2 mosquitto_passwd -c -b /work/passwd frio-test <password>
   ```
3. Levantar el stack:
   ```bash
   cd infra && docker compose up -d --build
   ```
4. Abrir `http://localhost:8080`, ingresar con `DASHBOARD_PASSWORD` y publicar una lectura de prueba:
   ```bash
   docker compose exec mosquitto mosquitto_pub -t frio/sucursal1/cam1/temp -m 3.5
   ```
   El sitio y su cámara aparecen en el dashboard en tiempo real.

## Estructura del repositorio

| Ruta | Qué es |
|------|--------|
| `firmware/sensor_node/` | Firmware de producción del nodo sensor (Arduino / ESP32). |
| `firmware/sensor_node_legacy/` | Primer prototipo: credenciales WiFi/MQTT fijas en `secrets.h`. Se conserva como referencia. |
| `firmware/test_sensor/` | Sketch mínimo que solo lee el bus DS18B20. Útil para validar el cableado. |
| `firmware/diag_bus/` | Diagnóstico del bus 1-Wire (pull-up y pulso de presencia en GPIO4). |
| `services/dashboard/` | Backend (ingesta, almacenamiento, API, alertas) y frontend PWA. |
| `infra/` | Stack de Docker Compose para desarrollo local: Mosquitto, dashboard, Node-RED. |

## Cómo funciona

### 1. Nodo sensor (firmware)

- **Hardware:** una placa ESP32 (desarrollado sobre ESP32-C3, botón BOOT en GPIO9) con una o más sondas DS18B20 en un único bus 1-Wire en **GPIO4**, con pull-up de 4,7 kΩ a 3,3 V. Cada sonda detectada en el bus se convierte en una cámara: `cam1`, `cam2`, ...
- **Medición:** ciclo no bloqueante cada 10 s (conversión de 12 bits, ~750 ms). Si al arrancar no se detecta ninguna sonda, el bus se vuelve a escanear en cada ciclo.
- **Configuración desde el celular:** en el primer arranque (o a pedido) el nodo abre un access point WPA2 `frio-XXXXXX` con un portal cautivo (se abre solo al conectar el celular). Desde ahí se configuran una **WiFi principal y una secundaria** y el **broker MQTT**; cada paso se prueba antes de guardarse. La configuración se guarda en NVS.
- **Contraseña del dispositivo:** la contraseña del AP es aleatoria por dispositivo (se genera una vez, se guarda en NVS y se imprime una sola vez por el monitor serie). Se puede fijar una contraseña en `secrets.h` (copiando `secrets.example.h`), pero solo para dispositivos propios.
- **Failover:** una máquina de estados WiFi no bloqueante pasa a la red secundaria cuando se cae el enlace principal (30 s de gracia) o el broker no responde (2 min), prueba la principal cada minuto y vuelve cuando su señal es suficiente. Las reconexiones usan backoff exponencial (5 s – 60 s).
- **Gestos del botón BOOT:**

  | Mantener | Acción |
  |----------|--------|
  | ≥ 3 s | Abre manualmente el AP de configuración (se cierra tras 15 min sin un celular conectado). |
  | ≥ 10 s | Reset de fábrica de la configuración de red (la contraseña del dispositivo se conserva). |

- **MQTT:** siempre sobre TLS (puerto 8883), validando el broker contra el bundle de CA en `mqtt_ca.h`.

### 2. Contrato MQTT

| Topic | Payload | Notas |
|-------|---------|-------|
| `frio/<site>/cam<N>/temp` | Número decimal, p. ej. `3.50` | °C. Se descartan lecturas fuera de -55 … 125. |
| `frio/<site>/status` | `online` \| `offline` | Retenido. `offline` es el Last Will de MQTT. |
| `frio/<site>/net` | `primary` \| `secondary` | Retenido. Indica qué red WiFi transporta la sesión. |

`<site>` y `<cam>` deben cumplir `[A-Za-z0-9_-]{1,64}`. El id del sitio se define con `SITE_ID` en `sensor_node.ino`.

### 3. Servicio dashboard

- **Ingesta:** se suscribe a los tres topics anteriores, valida cada mensaje y descarta lo malformado sin caerse.
- **Almacenamiento:** SQLite (`better-sqlite3`). Las lecturas más antiguas que `RETENTION_DAYS` se purgan.
- **Tiempo real:** server-sent events (`/api/stream`). Una cámara sin lecturas durante `STALE_AFTER_MS` se muestra como desactualizada.
- **Alertas:** umbrales mínimo/máximo por cámara, configurables desde el dashboard. Una alerta se abre una sola vez cuando una lectura cruza un umbral (o un sitio queda offline) y se cierra cuando vuelve a la normalidad; ambos eventos se notifican por Telegram.
- **Acceso:** contraseña única compartida, cookie de sesión y login con rate limit.
- **Frontend:** PWA instalable hecha con Preact + signals, tarjetas de cámaras en vivo y gráficos históricos con uPlot.

#### API

| Método | Ruta | Uso |
|--------|------|-----|
| `POST` | `/api/login`, `/api/logout` | Manejo de sesión. |
| `GET` | `/api/sites` | Sitios, cámaras, últimas lecturas y estado. |
| `GET` | `/api/history` | Historial de lecturas para los gráficos. |
| `GET` | `/api/stream` | Actualizaciones en vivo (SSE). |
| `PUT` | `/api/config/:site/:cam` | Nombre de la cámara y umbrales mínimo/máximo. |
| `GET` | `/healthz` | Health check. |

#### Configuración

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `DASHBOARD_PASSWORD` | — (obligatoria) | Contraseña de ingreso. |
| `MQTT_URL` | `mqtt://mosquitto:1883` | URL del broker. |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | vacío | Credenciales del broker, si hacen falta. |
| `DB_PATH` | `/data/frio.db` | Archivo SQLite. |
| `PORT` | `8080` | Puerto HTTP. |
| `RETENTION_DAYS` | `30` | Días de lecturas que se conservan. |
| `STALE_AFTER_MS` | `30000` | Tiempo sin datos antes de marcar una cámara como desactualizada. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | vacío | Habilitan las alertas por Telegram cuando ambas están definidas. |

### 4. Infraestructura local

`infra/docker-compose.yml` levanta:

| Servicio | Puerto | Notas |
|----------|--------|-------|
| Mosquitto | `1883` | Anónimo, solo para desarrollo. |
| Mosquitto | `1884` | Requiere un usuario de `infra/mosquitto/passwd`. |
| Dashboard | `8080` | Se construye desde `services/dashboard`. |
| Node-RED | `1880` | Opcional, para experimentar con flujos. |

> El broker local no tiene TLS. El firmware de producción se conecta con TLS en el puerto 8883, así que para probar contra `infra/` hay que apuntarlo a un broker con listener TLS (o adaptar el firmware).

## Desarrollo

### Dashboard

```bash
cd services/dashboard
npm install
npm run dev:server   # backend en modo watch (requiere DASHBOARD_PASSWORD y un MQTT_URL accesible)
npm run dev:web      # servidor de desarrollo de Vite para la PWA
npm run check        # typecheck + tests + build
```

Los tests usan el test runner nativo de Node (`npm test`).

### Firmware

1. Instalar Arduino IDE (o `arduino-cli`) con el paquete de placas **esp32**.
2. Instalar las librerías: `OneWire`, `DallasTemperature`, `PubSubClient`.
3. Opcional: copiar `firmware/sensor_node/secrets.example.h` a `secrets.h` (ignorado por git) para fijar la contraseña del dispositivo.
4. Ajustar `SITE_ID` y las constantes de tiempo en `sensor_node.ino` si hace falta.
5. Flashear `firmware/sensor_node/`, abrir el monitor serie a 115200 baudios y anotar la contraseña del dispositivo.
6. Conectar el celular a `frio-XXXXXX` y completar la configuración en el portal.

Si no se detectan sondas, flashear `firmware/test_sensor/` o `firmware/diag_bus/` para revisar el cableado.

## Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Firmware | ESP32, framework Arduino, OneWire, DallasTemperature, PubSubClient, WiFiClientSecure |
| Mensajería | MQTT, Eclipse Mosquitto 2 |
| Backend | Node.js 24, TypeScript, Fastify 5, mqtt.js, better-sqlite3 |
| Frontend | Preact, @preact/signals, uPlot, Vite, vite-plugin-pwa |
| Notificaciones | Telegram Bot API |
| Infraestructura | Docker, Docker Compose |
