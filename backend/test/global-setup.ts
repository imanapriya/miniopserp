import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../src/database/data-source';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

/**
 * Runs ONCE before the whole suite.
 *
 * Rebuilds the test database from the checked-in migrations rather than from
 * `synchronize: true`. That matters: the CHECK constraints these tests rely on
 * are defined in the migrations, so testing against a synchronised schema
 * would not be testing what actually ships.
 */
export default async function globalSetup() {
  process.env.NODE_ENV = 'test';

  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env first.');
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL must point at a different database from DATABASE_URL - the suite wipes it.',
    );
  }

  const dataSource = new DataSource(buildDataSourceOptions({ url } as any));
  await dataSource.initialize();
  try {
    await dataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
  } finally {
    await dataSource.destroy();
  }

  const migrator = new DataSource(buildDataSourceOptions({ url } as any));
  await migrator.initialize();
  try {
    await migrator.runMigrations();
  } finally {
    await migrator.destroy();
  }
}
