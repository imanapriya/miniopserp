/**
 * Environment-based configuration.
 *
 * Everything the app needs to talk to the outside world comes from env vars,
 * and nothing else in the codebase reads `process.env` directly. That is what
 * makes the app portable: the same image runs against a local PostgreSQL, a
 * Docker container, RDS, Neon or Supabase with no code change.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy backend/.env.example to backend/.env and fill it in.`,
    );
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, received "${raw}".`);
  }
  return parsed;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigins: string[];
  database: { url: string; ssl: boolean; logging: boolean };
  jwt: { secret: string; expiresIn: string };
  bcryptRounds: number;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  // The test suite points at a throwaway database so a careless `npm test`
  // can never truncate development data.
  const databaseUrl =
    nodeEnv === 'test'
      ? process.env.TEST_DATABASE_URL ?? required('DATABASE_URL')
      : required('DATABASE_URL');

  const secret = process.env.JWT_SECRET ?? (nodeEnv === 'test' ? 'test-secret' : undefined);
  if (!secret) required('JWT_SECRET');

  if (nodeEnv === 'production' && secret === 'change-me-in-production') {
    throw new Error('JWT_SECRET is still the default value. Set a real secret before deploying.');
  }

  return {
    port: int('PORT', 3000),
    nodeEnv,
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    database: {
      url: databaseUrl,
      // Managed providers (RDS, Neon, Supabase) require TLS; local usually does not.
      ssl: (process.env.DATABASE_SSL ?? 'false') === 'true',
      logging: (process.env.DATABASE_LOGGING ?? 'false') === 'true',
    },
    jwt: {
      secret,
      expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
    },
    bcryptRounds: int('BCRYPT_ROUNDS', 10),
  };
}
