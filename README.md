# sis-frio

Sistema para **controlar la temperatura de cámaras de frío** (heladeras industriales, cámaras de un depósito, etc.) desde el celular.

Pones un pequeño dispositivo con sensores de temperatura dentro de cada cámara, y desde una página web ves en vivo cuántos grados hay en cada una. Si una cámara se calienta (o se enfría) de más, o si el dispositivo se desconecta, te llega un aviso por **Telegram**.

## ¿Cómo funciona? (la idea general)

El sistema tiene tres partes que se pasan los datos en cadena:

```text
 Sensor en la cámara  ──▶  "Cartero" de mensajes  ──▶  Servidor + página web  ──▶  Tu celular
   (ESP32 + DS18B20)         (broker MQTT)              (dashboard)               (y avisos por Telegram)
```

1. **El dispositivo (ESP32)**: es una placa electrónica chiquita y barata con WiFi. Tiene conectadas una o más sondas de temperatura (DS18B20). Cada 10 segundos mide la temperatura y la envía por internet.
2. **El broker MQTT (Mosquitto)**: funciona como un cartero. El dispositivo le deja los mensajes con las temperaturas, y el broker se los entrega a quien esté interesado en recibirlos. MQTT es un protocolo de mensajes muy liviano, pensado justamente para este tipo de dispositivos.
3. **El dashboard**: es un servidor que recibe esos mensajes, los guarda en una base de datos y los muestra en una página web. Esa página se puede instalar en el celular como si fuera una app. También es el que manda los avisos por Telegram.

## Lo que hace el sistema

- Muestra la temperatura de cada cámara **en tiempo real**.
- Guarda el **historial** y lo muestra en gráficos (por defecto, los últimos 30 días).
- Permite definir, para cada cámara, una **temperatura mínima y máxima**. Si se pasa de ese rango, avisa por Telegram, y vuelve a avisar cuando se normaliza.
- Avisa si un dispositivo **se queda sin conexión**.
- La página está **protegida con contraseña**.

## El dispositivo, explicado simple

- **Se configura desde el celular**, sin tocar código. La primera vez que se enciende, crea su propia red WiFi llamada `frio-XXXXXX`. Te conectas desde el celular, se abre una página, y ahí cargas la WiFi del lugar y los datos del servidor. Antes de guardar cada dato, el dispositivo prueba que funcione.
- **Tiene una WiFi de respaldo.** Puedes cargarle dos redes: si la principal se cae, se pasa sola a la secundaria, y cuando la principal vuelve, regresa a ella.
- **Su red de configuración tiene contraseña.** Cada dispositivo genera la suya al azar la primera vez y la muestra una sola vez por el monitor serie (el cable USB conectado a la computadora). Hay que anotarla.
- **El botón BOOT de la placa** sirve para dos cosas:
  - Mantenerlo apretado **3 segundos**: vuelve a abrir la red de configuración (por ejemplo, para cambiar la WiFi).
  - Mantenerlo apretado **10 segundos**: borra la configuración de red y deja el dispositivo como nuevo (la contraseña del dispositivo no se borra).
- **Cada sonda es una cámara.** Si conectas 3 sondas, en la página aparecen `cam1`, `cam2` y `cam3`. Después les puedes poner un nombre desde el dashboard.
- **La conexión es segura**: los datos viajan cifrados (TLS) hasta el broker.

## Cómo probarlo en tu computadora

Solo necesitas tener instalado **Docker** (con Docker Compose). Docker levanta el broker y el dashboard sin que tengas que instalar nada más.

1. **Copia el archivo de configuración** y escribe adentro una contraseña para entrar al dashboard:
   ```bash
   cp infra/.env.example infra/.env
   ```
   Abre `infra/.env` y completa `DASHBOARD_PASSWORD=tu-contraseña`.

2. **Crea el usuario del broker** (Mosquitto no arranca sin este archivo). Desde la carpeta `infra/`, ejecuta:
   ```bash
   docker run --rm -v ${PWD}/mosquitto:/work eclipse-mosquitto:2 mosquitto_passwd -c -b /work/passwd frio-test <una-contraseña>
   ```

3. **Levanta todo**:
   ```bash
   cd infra
   docker compose up -d --build
   ```

4. **Entra al dashboard** en `http://localhost:8080` con la contraseña del paso 1.

5. **Simula un sensor** enviando una temperatura a mano:
   ```bash
   docker compose exec mosquitto mosquitto_pub -t frio/sucursal1/cam1/temp -m 3.5
   ```
   En la página debería aparecer el sitio `sucursal1` con su cámara `cam1` marcando 3,5 °C.

> **Ojo:** el broker que se levanta en tu computadora no usa cifrado, y el dispositivo real siempre se conecta cifrado. Por eso, para probar con una placa física necesitas un broker con TLS (o adaptar el firmware).

## Cómo cargar el programa en la placa

1. Instala el **Arduino IDE** y agrega el soporte para placas **ESP32**.
2. Instala estas librerías desde el gestor de librerías: `OneWire`, `DallasTemperature` y `PubSubClient`.
3. Conecta las sondas DS18B20 al pin **GPIO4**, con una resistencia de **4,7 kΩ** entre ese pin y 3,3 V.
4. Abre la carpeta `firmware/sensor_node/`, carga el programa en la placa y abre el monitor serie (velocidad 115200). **Anota la contraseña que aparece.**
5. Desde el celular, conéctate a la red `frio-XXXXXX` y completa la configuración.

¿No detecta los sensores? Carga primero `firmware/test_sensor/` (solo lee los sensores) o `firmware/diag_bus/` (revisa que el cableado esté bien).

## Qué hay en cada carpeta

| Carpeta | Qué contiene |
|---------|--------------|
| `firmware/sensor_node/` | El programa del dispositivo (el que se usa de verdad). |
| `firmware/sensor_node_legacy/` | La primera versión, más simple. Quedó como referencia. |
| `firmware/test_sensor/` | Programa mínimo para probar que los sensores se lean bien. |
| `firmware/diag_bus/` | Programa para diagnosticar problemas de cableado. |
| `services/dashboard/` | El servidor y la página web. |
| `infra/` | Lo necesario para levantar todo con Docker en tu computadora. |

## Tecnologías usadas

- **Dispositivo:** placa ESP32 programada con Arduino, sensores DS18B20.
- **Mensajería:** MQTT con el broker Mosquitto.
- **Servidor:** Node.js con TypeScript y Fastify; los datos se guardan en SQLite.
- **Página web:** Preact (una alternativa liviana a React), instalable como app (PWA), gráficos con uPlot.
- **Avisos:** bot de Telegram.
- **Para correr todo:** Docker y Docker Compose.

## Para desarrolladores

Si vas a modificar el dashboard:

```bash
cd services/dashboard
npm install
npm run dev:server   # levanta el servidor y se reinicia solo al guardar cambios
npm run dev:web      # levanta la página web en modo desarrollo
npm test             # corre los tests
npm run check        # revisa tipos, corre los tests y compila todo
```

El dashboard se configura con variables de entorno. Las más importantes:

| Variable | Para qué sirve |
|----------|----------------|
| `DASHBOARD_PASSWORD` | Contraseña para entrar (obligatoria). |
| `MQTT_URL` | Dirección del broker (por defecto `mqtt://mosquitto:1883`). |
| `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` | Datos del bot de Telegram. Si no se completan, no se envían avisos. |
| `RETENTION_DAYS` | Cuántos días de historial se guardan (por defecto 30). |

Los mensajes que envía el dispositivo usan estos "temas" (topics) de MQTT:

| Topic | Qué lleva |
|-------|-----------|
| `frio/<sitio>/cam<N>/temp` | La temperatura en °C, por ejemplo `3.50`. |
| `frio/<sitio>/status` | `online` u `offline` (si el dispositivo está conectado). |
| `frio/<sitio>/net` | `primary` o `secondary` (qué WiFi está usando). |
