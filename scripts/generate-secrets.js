import { randomBytes } from 'node:crypto';

// Run on your own computer/server. Treat all output as secret; never commit it.
console.log(`SESSION_SECRET=${randomBytes(32).toString('hex')}`);
console.log(`POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`);
