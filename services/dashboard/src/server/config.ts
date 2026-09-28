export interface Config {
  mqttUrl: string;
  dbPath: string;
  port: number;
  retentionDays: number;
  staleAfterMs: number;
  dashboardPassword: string;
}

function readEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value === '' ? fallback : value;
}

function readNumberEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): number {
  const raw = readEnv(env, name, fallback);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number, got ${JSON.stringify(raw)}.`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dashboardPassword = env.DASHBOARD_PASSWORD;
  if (dashboardPassword === undefined || dashboardPassword === '') {
    throw new Error(
      'DASHBOARD_PASSWORD is required and must be non-empty. Set it in infra/.env before starting the dashboard.',
    );
  }

  return {
    mqttUrl: readEnv(env, 'MQTT_URL', 'mqtt://mosquitto:1883'),
    dbPath: readEnv(env, 'DB_PATH', '/data/frio.db'),
    port: readNumberEnv(env, 'PORT', '8080'),
    retentionDays: readNumberEnv(env, 'RETENTION_DAYS', '30'),
    staleAfterMs: readNumberEnv(env, 'STALE_AFTER_MS', '30000'),
    dashboardPassword,
  };
}
