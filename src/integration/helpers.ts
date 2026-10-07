/**
 * Shared plumbing for the integration suites in src/integration.
 *
 * These suites drive a REAL `next start` server (started by scripts/run-tests.mjs)
 * against a REAL PostgreSQL database and local stand-ins for Meta, the Instagram
 * CDN, the Telegram Bot API and SMTP. They are skipped when the harness is not
 * present, which is what makes `npm run test:unit` fast and `npm test` complete.
 */
import crypto from 'node:crypto';
import { expect } from 'vitest';

export const BASE_URL = process.env.INTEGRATION_BASE_URL || '';
/** The public origin the application believes it is deployed at (HTTPS). */
export const APP_URL = process.env.APP_URL || BASE_URL;
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
export const GRAPH_CONTROL_URL = process.env.META_GRAPH_BASE_URL || '';
export const TELEGRAM_BASE_URL = process.env.TELEGRAM_API_BASE_URL || '';
export const MAIL_DROP_DIR = process.env.MOCK_MAIL_DROP || '/tmp/maildrop';
export const MOCK_TELEGRAM_LOG = process.env.MOCK_TELEGRAM_LOG || '/tmp/telegram-mock-requests.jsonl';
export const MOCK_GRAPH_LOG = process.env.MOCK_GRAPH_LOG || '/tmp/graph-mock-requests.jsonl';

export const integrationEnabled = Boolean(BASE_URL && TEST_DATABASE_URL);

export const META_APP_SECRET = process.env.META_APP_SECRET || '';
export const META_APP_ID = process.env.META_APP_ID || '';
export const IG_ACCOUNT_ID = 'ig-mock-1';
export const PAGE_ID = 'page-mock-1';
export const PAGE_TOKEN = process.env.MOCK_PAGE_TOKEN || 'EAAG-mock-page-access-token-0123456789';

export const ADMIN_IDENTIFIER = process.env.ADMIN_LOGIN_IDENTIFIER || 'admin@instadm.test';
export const ADMIN_PASSWORD = 'AdminPassw0rd!';

/** The `name` column of pg_tables is text; keep the quoting identical to the engine. */
export async function truncateAll(prisma: { $executeRawUnsafe: (sql: string) => Promise<unknown>; $queryRawUnsafe: <T>(sql: string) => Promise<T> }) {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  const tables = rows.map((row) => `"${row.tablename.replace(/"/g, '""')}"`);
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.join(', ')} CASCADE`);
}

export type Json = Record<string, any>;

export class Session {
  private cookies = new Map<string, string>();

  constructor(private readonly baseUrl = BASE_URL) {}

  cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  absorb(response: Response) {
    const setCookies: string[] = typeof (response.headers as any).getSetCookie === 'function'
      ? (response.headers as any).getSetCookie()
      : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie') as string] : []);
    for (const cookie of setCookies) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    return response;
  }

  async fetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    // The CSRF guard requires same-origin state-changing requests; sending the
    // header the browser would send is the honest way to exercise it.
    if (init.method && init.method !== 'GET' && init.method !== 'HEAD') {
      headers.set('Origin', this.baseUrl);
    }
    const cookie = this.cookieHeader();
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetch(new URL(path, this.baseUrl), { ...init, headers, redirect: 'manual' });
    return this.absorb(response);
  }

  json<T = Json>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T; response: Response }> {
    return this.fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers as Json | undefined) },
    }).then(async (response) => ({
      status: response.status,
      response,
      body: (await response.json().catch(() => ({}))) as T,
    }));
  }
}

export function signMetaBody(rawBody: string, secret = META_APP_SECRET): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

/** Posts a Meta webhook exactly the way Meta does: raw body + HMAC signature. */
export async function postMetaWebhook(session: Session, payload: unknown) {
  const raw = JSON.stringify(payload);
  return session.fetch('/api/webhooks/meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signMetaBody(raw) },
    body: raw,
  });
}

export function commentWebhook(params: {
  instagramAccountId: string;
  mediaId: string;
  commentId: string;
  commenterId: string;
  commenterUsername?: string;
  text: string;
}) {
  return {
    object: 'instagram',
    entry: [{
      id: params.instagramAccountId,
      time: Date.now(),
      changes: [{
        field: 'comments',
        value: {
          id: params.commentId,
          text: params.text,
          media: { id: params.mediaId },
          from: { id: params.commenterId, username: params.commenterUsername || 'fan.account' },
          recipient_id: params.instagramAccountId,
        },
      }],
    }],
  };
}

export function postbackWebhook(params: {
  instagramAccountId: string;
  senderId: string;
  payload: string;
  mid?: string;
}) {
  return {
    object: 'instagram',
    entry: [{
      id: params.instagramAccountId,
      time: Date.now(),
      messaging: [{
        sender: { id: params.senderId },
        recipient: { id: params.instagramAccountId },
        timestamp: Date.now(),
        postback: { mid: params.mid || `mid-${Date.now()}-${Math.random()}`, payload: params.payload },
      }],
    }],
  };
}

export function textWebhook(params: {
  instagramAccountId: string;
  senderId: string;
  text: string;
  mid?: string;
}) {
  return {
    object: 'instagram',
    entry: [{
      id: params.instagramAccountId,
      time: Date.now(),
      messaging: [{
        sender: { id: params.senderId },
        recipient: { id: params.instagramAccountId },
        timestamp: Date.now(),
        message: { mid: params.mid || `mid-${Date.now()}-${Math.random()}`, text: params.text },
      }],
    }],
  };
}

/** Flips the mock Graph API's `is_user_follow_business` answer. */
export async function setMockFollowing(value: boolean) {
  const response = await fetch(`${GRAPH_CONTROL_URL}/v26.0/__control/following?value=${value}`);
  expect(response.status).toBe(200);
}

export async function setMockMediaError(code: number | null) {
  const query = code === null ? '' : `?code=${code}`;
  const response = await fetch(`${GRAPH_CONTROL_URL}/v26.0/__control/media-error${query}`);
  expect(response.status).toBe(200);
}

/** Chooses which CDN object the mock Graph API reports as the profile picture. */
export async function setMockAvatarPath(avatarPath: string) {
  const response = await fetch(`${GRAPH_CONTROL_URL}/v26.0/__control/avatar?path=${encodeURIComponent(avatarPath)}`);
  expect(response.status).toBe(200);
}

export async function resetGraphControl() {
  const response = await fetch(`${GRAPH_CONTROL_URL}/v26.0/__control/reset`);
  expect(response.status).toBe(200);
}

export async function resetTelegramMock() {
  const response = await fetch(`${TELEGRAM_BASE_URL}/bot0:0/__reset`);
  expect(response.status).toBe(200);
}

export async function readGraphCalls(): Promise<Array<{ method: string; path: string; query: Json; authorization: string | null; body: string | null }>> {
  const fs = await import('node:fs/promises');
  try {
    const content = await fs.readFile(MOCK_GRAPH_LOG, 'utf8');
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export const MOCK_CDN_LOG = process.env.MOCK_CDN_LOG || '/tmp/cdn-mock-requests.jsonl';

/** Paths the fake CDN actually served; proves what the proxy did (not) request. */
export async function readCdnPaths(): Promise<string[]> {
  const fs = await import('node:fs/promises');
  try {
    const content = await fs.readFile(MOCK_CDN_LOG, 'utf8');
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line).path as string);
  } catch {
    return [];
  }
}

export async function readTelegramCalls(): Promise<Array<{ method: string; body: Json }>> {
  const fs = await import('node:fs/promises');
  try {
    const content = await fs.readFile(MOCK_TELEGRAM_LOG, 'utf8');
    return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function truncateMockLogs(file: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:fs').writeFileSync(file, '');
}

export type MailMessage = {
  file: string;
  index: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  /** Raw MIME body exactly as SMTP delivered it. */
  body: string;
  /** Quoted-printable decoded body, for readable assertions. */
  text: string;
};

/** Decodes quoted-printable (soft line breaks + =XX escapes) and base64 parts. */
export function decodeMimeBody(body: string): string {
  const decodedParts = body.split(/\r?\n--/).map((part) => {
    const separator = part.indexOf('\r\n\r\n') !== -1 ? '\r\n\r\n' : '\n\n';
    const headers = part.slice(0, part.indexOf(separator) === -1 ? part.length : part.indexOf(separator));
    const content = part.indexOf(separator) === -1 ? '' : part.slice(part.indexOf(separator) + separator.length);
    if (/content-transfer-encoding:\s*base64/i.test(headers)) {
      try {
        return Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf8');
      } catch {
        return content;
      }
    }
    return content
      // MIME boundary lines are not content: they can contain digit runs that
      // must never be mistaken for a verification code.
      .split(/\r?\n/)
      .filter((line) => !/^--/.test(line.trim()))
      .join('\n')
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_match, hex) => Buffer.from(hex, 'hex').toString('binary'));
  });
  const joined = decodedParts.join('\n');
  // Re-decode as UTF-8: the =XX escapes above produced binary bytes.
  return Buffer.from(joined, 'binary').toString('utf8');
}

export async function readMails(): Promise<MailMessage[]> {
  const fs = await import('node:fs/promises');
  try {
    const content = await fs.readFile(`${MAIL_DROP_DIR}/index.jsonl`, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parsed = JSON.parse(line) as Omit<MailMessage, 'text'>;
        return { ...parsed, text: decodeMimeBody(parsed.body) };
      });
  } catch {
    return [];
  }
}

export async function clearMails() {
  const fs = await import('node:fs/promises');
  await fs.rm(`${MAIL_DROP_DIR}/index.jsonl`, { force: true });
}

/** Polls until `check` returns a truthy value or the timeout expires. */
export async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 10_000, label = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value as T;
      last = value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}. Last value: ${String(last)}`);
}

/** OTP is sent inside the real mail body; the test reads it from there. */
export function extractOtp(mail: MailMessage): string {
  const decoded = decodeMimeBody(mail.body);
  // Prefer the sentence the mail actually uses, then fall back to a standalone
  // 6-digit number.
  const match = decoded.match(/code is[:\s]*(\d{6})/i) || decoded.match(/(?:^|\s)(\d{6})(?:\s|$)/);
  if (!match) throw new Error(`No 6-digit code found in mail ${mail.subject}:\n${decoded}`);
  return match[1];
}
