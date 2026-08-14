import 'reflect-metadata';
import * as dotenvFlow from 'dotenv';
import * as path from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';

dotenvFlow.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/**
 * Shared TypeORM options.
 *
 * `synchronize` is false everywhere. Schema changes go through checked-in
 * migrations so that development, CI and production always converge on the
 * exact same DDL - including the CHECK constraints that the business rules
 * depend on.
 */
export function buildDataSourceOptions(overrides: Partial<DataSourceOptions> = {}): DataSourceOptions {
  const url =
    process.env.NODE_ENV === 'test'
      ? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
      : process.env.DATABASE_URL;

  return {
    type: 'postgres',
    url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    entities: ALL_ENTITIES,
    migrations: [path.join(__dirname, 'migrations/*.{ts,js}')],
    migrationsTableName: 'migrations',
    synchronize: false,
    logging: process.env.DATABASE_LOGGING === 'true' ? ['query', 'error'] : ['error'],
    ...overrides,
  } as DataSourceOptions;
}

/** Used by the TypeORM CLI (`npm run migration:run`). */
export default new DataSource(buildDataSourceOptions());
