#!/usr/bin/env node
/**
 * Generates a cryptographically random JWT secret.
 * Run once and paste the output into your .env.production file.
 *
 * Usage:
 *   node scripts/generate-secret.js
 */
const crypto = require('crypto');
const secret = crypto.randomBytes(64).toString('hex');
console.log('\nYour JWT_SECRET (copy this into .env.production):\n');
console.log(secret);
console.log('\nKeep it safe — treat it like a password.\n');
