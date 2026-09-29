#!/usr/bin/env node
import process from 'node:process';

const errors = [];
const required = [
  'DATABASE_URL',
  'APP_URL',
  'AUTH_SECRET',
  'ENCRYPTION_KEY',
  'CRON_SECRET',
  'SETUP_TOKEN',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_VERIFY_TOKEN',
  'META_GRAPH_API_VERSION',
  'META_REDIRECT_URI',
];
for (const name of required) {
  if (!process.env[name]?.trim()) errors.push(`${name} is required`);
}

function httpsUrl(name, value) {
  try {
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url;
  } catch {
    errors.push(`${name} must be a public HTTPS URL`);
    return null;
  }
}

let databaseUrl = null;
try {
  databaseUrl = new URL(process.env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseUrl.hostname || !databaseUrl.pathname.slice(1)) throw new Error();
} catch {
  errors.push('DATABASE_URL must be a PostgreSQL connection URL with a host and database name');
}

const appUrl = httpsUrl('APP_URL', process.env.APP_URL);
const redirect = httpsUrl('META_REDIRECT_URI', process.env.META_REDIRECT_URI);
if (process.env.NODE_ENV === 'production') {
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (appUrl && localHosts.has(appUrl.hostname)) errors.push('APP_URL cannot use a local hostname in production');
  if (databaseUrl && localHosts.has(databaseUrl.hostname)) errors.push('DATABASE_URL cannot use a local hostname in production');
}
if (appUrl && redirect && redirect.toString() !== `${appUrl.origin}/api/auth/meta/callback`) {
  errors.push('META_REDIRECT_URI must equal APP_URL + /api/auth/meta/callback');
}
if ((process.env.AUTH_SECRET || '').length < 32) errors.push('AUTH_SECRET must be at least 32 characters');
if (!/^[a-fA-F0-9]{64}$/.test(process.env.ENCRYPTION_KEY || '')) errors.push('ENCRYPTION_KEY must be exactly 64 hexadecimal characters');
if ((process.env.CRON_SECRET || '').length < 24) errors.push('CRON_SECRET must be at least 24 characters');
if ((process.env.SETUP_TOKEN || '').length < 24) errors.push('SETUP_TOKEN must be at least 24 characters');
if ((process.env.META_VERIFY_TOKEN || '').length < 16) errors.push('META_VERIFY_TOKEN must be at least 16 characters');
if (!/^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION || '')) errors.push('META_GRAPH_API_VERSION must look like v21.0');
if (process.env.UPI_ID && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(process.env.UPI_ID.trim())) errors.push('UPI_ID is invalid');
if (Boolean(process.env.UPI_ID?.trim()) !== Boolean(process.env.UPI_PAYEE_NAME?.trim())) {
  errors.push('Configure both UPI_ID and UPI_PAYEE_NAME, or neither');
}

const independentSecrets = ['AUTH_SECRET', 'CRON_SECRET', 'SETUP_TOKEN', 'META_VERIFY_TOKEN'];
const populatedSecrets = independentSecrets.map((name) => [name, process.env[name]?.trim()]).filter((entry) => entry[1]);
for (let left = 0; left < populatedSecrets.length; left += 1) {
  for (let right = left + 1; right < populatedSecrets.length; right += 1) {
    if (populatedSecrets[left][1] === populatedSecrets[right][1]) {
      errors.push(`${populatedSecrets[left][0]} and ${populatedSecrets[right][0]} must be different secrets`);
    }
  }
}

const smtpNames = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
const smtpCount = smtpNames.filter((name) => process.env[name]?.trim()).length;
if (smtpCount > 0 && smtpCount < smtpNames.length) errors.push(`SMTP is partial; configure all of: ${smtpNames.join(', ')}`);
if (smtpCount === smtpNames.length && (!/^\d+$/.test(process.env.SMTP_PORT || '') || Number(process.env.SMTP_PORT) < 1 || Number(process.env.SMTP_PORT) > 65535)) {
  errors.push('SMTP_PORT must be an integer from 1 to 65535');
}
const telegramCount = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'].filter((name) => process.env[name]?.trim()).length;
if (telegramCount === 1) errors.push('Configure both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, or neither');

if (errors.length) {
  console.error('Environment validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Environment validation passed. No secret values were printed.');
