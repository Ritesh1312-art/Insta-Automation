#!/usr/bin/env node
/**
 * Create (or reset) the ADMIN account from the command line.
 *
 * Usage — run where the database is reachable, with DATABASE_URL set:
 *   DATABASE_URL="postgresql://user:pass@host:5432/db" \
 *   node scripts/create-admin.mjs --email you@example.com --password 'Secure#1234'
 *
 * Add --reset to change the password of an existing admin.
 *
 * No credentials are stored anywhere in git. The password is hashed with
 * bcrypt before it touches the database. For the web flow use /setup once.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

function fail(message) {
  console.error('Error:', message);
  process.exit(1);
}

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
}

const email = arg('email');
const password = arg('password');
const reset = args.includes('--reset');

if (!email || !/^\S+@\S+\.\S+$/.test(email)) fail('Pass --email you@example.com');
const validPassword = typeof password === 'string'
  && password.length >= 10
  && password.length <= 20
  && /[A-Z]/.test(password)
  && /[a-z]/.test(password)
  && /[0-9]/.test(password)
  && /[^A-Za-z0-9\s]/.test(password);
if (!validPassword) {
  fail('Password must be 10–20 characters with uppercase, lowercase, number, and special character');
}
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set — export the production connection string first');

const prisma = new PrismaClient();
const normalizedEmail = email.trim().toLowerCase();

try {
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing && existing.role === 'ADMIN' && !reset) {
    fail('This admin already exists. Add --reset to change the password.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    create: {
      email: normalizedEmail,
      passwordHash,
      role: 'ADMIN',
      plan: 'FREE',
      monthlyDmQuota: 30,
      subscriptionStatus: 'ACTIVE',
      quotaResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    update: { passwordHash, role: 'ADMIN' },
  });

  console.log('Admin ready:', user.email, `(id ${user.id})`);
  console.log('Sign in at /login with this email and password.');
} catch (error) {
  fail(error.message || 'Unable to create admin');
} finally {
  await prisma.$disconnect();
}
