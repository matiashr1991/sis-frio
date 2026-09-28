import mqtt, { type MqttClient } from 'mqtt';
import { randomBytes } from 'node:crypto';
import { parseMessage } from './parse.js';
import type { Store } from '../store/db.js';
import type { Hub } from '../live/hub.js';

const READING_TOPIC = 'frio/+/+/temp';
const STATUS_TOPIC = 'frio/+/status';

export interface IngestLogger {
  debug: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

const consoleLogger: IngestLogger = {
  debug: (msg, ...args) => console.debug(`[ingest] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ingest] ${msg}`, ...args),
};

export interface IngestHandle {
  client: MqttClient;
  isConnected: () => boolean;
  close: () => Promise<void>;
}

export function startIngest(
  mqttUrl: string,
  store: Store,
  hub: Hub,
  logger: IngestLogger = consoleLogger,
): IngestHandle {
  const clientId = `frio-dashboard-${randomBytes(3).toString('hex')}`;
  let connected = false;

  const client = mqtt.connect(mqttUrl, {
    clientId,
    clean: true,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    connected = true;
    client.subscribe([READING_TOPIC, STATUS_TOPIC], { qos: 0 }, (err) => {
      if (err) logger.error('subscribe failed', err);
    });
  });

  client.on('reconnect', () => {
    connected = false;
  });

  client.on('close', () => {
    connected = false;
  });

  client.on('error', (err) => {
    logger.error('mqtt client error', err);
  });

  client.on('message', (topic, payload) => {
    const parsed = parseMessage(topic, payload.toString('utf8'));
    if (!parsed) {
      logger.debug(`dropped message on ${topic}`);
      return;
    }

    const ts = Date.now();
    try {
      if (parsed.type === 'reading') {
        store.insertReading(parsed.site, parsed.cam, ts, parsed.temp);
        hub.recordReading(parsed.site, parsed.cam, parsed.temp, ts);
      } else {
        store.upsertStatus(parsed.site, parsed.status, ts);
        hub.recordStatus(parsed.site, parsed.status, ts);
      }
    } catch (err) {
      logger.error(`failed to persist message on ${topic}, dropping`, err);
    }
  });

  return {
    client,
    isConnected: () => connected,
    close: () =>
      new Promise<void>((resolve) => {
        client.end(false, {}, () => resolve());
      }),
  };
}
