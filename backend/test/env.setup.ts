import * as dotenv from 'dotenv';
import * as path from 'path';

// Forces the app to resolve TEST_DATABASE_URL instead of DATABASE_URL, so the
// suite can truncate freely without ever touching development data.
process.env.NODE_ENV = 'test';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
// Cheapest bcrypt cost that is still a real hash - the suite creates users
// constantly and the default cost would dominate the runtime.
process.env.BCRYPT_ROUNDS = '4';
