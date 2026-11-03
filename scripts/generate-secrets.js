import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/auth.js';

// Run on your own computer/server. Treat all output as secret; never commit it.
const password = randomBytes(18).toString('base64url');
console.log(`BOARD_LOGIN_PASSWORD=${password}`);
console.log(`AUTH_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString('hex')}`);
console.log(`POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`);
