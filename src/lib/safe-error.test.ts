import { describe, expect, it } from 'vitest';
import { REDACTED, redactSecrets, safeErrorMessage } from './safe-error';

describe('redactSecrets', () => {
  it('removes explicitly supplied secrets and known credential shapes', () => {
    const token = 'page-token-value-123456';
    const text = [
      `token ${token} rejected`,
      'Authorization: Bearer abc.def-ghi',
      'GET /me?access_token=secret123&fields=id',
      'Meta token EAAGm0PX4ZCpsBAKZCZD1234567890',
      'session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl',
      'db postgresql://admin:hunter2@db.example.com:5432/prod',
    ].join('\n');
    const redacted = redactSecrets(text, [token]);
    for (const secret of [token, 'abc.def-ghi', 'secret123', 'EAAGm0PX4ZCpsBAKZCZD1234567890', 'c2lnbmF0dXJlLXZhbHVl', 'hunter2']) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain(`Bearer ${REDACTED}`);
    expect(redacted).toContain(`access_token=${REDACTED}&fields=id`);
  });

  it('ignores empty or very short secret values instead of shredding ordinary text', () => {
    expect(redactSecrets('the quota was reached', ['', null, undefined, 'the'])).toBe('the quota was reached');
  });
});

describe('safeErrorMessage', () => {
  it('reduces Prisma request errors to their code and database message', () => {
    const error = Object.assign(new Error('Invalid `prisma.$queryRaw()` invocation: ... comment text "call me at 555-0100"'), {
      code: 'P2010',
      meta: { message: "Failed to deserialize column of type 'void'." },
    });
    expect(safeErrorMessage(error)).toBe("Database error P2010: Failed to deserialize column of type 'void'.");
  });

  it('never surfaces Prisma errors that echo query arguments', () => {
    const error = Object.assign(new Error('Argument data.commentText: "my private message"'), { name: 'PrismaClientValidationError' });
    expect(safeErrorMessage(error)).toBe('Database error (PrismaClientValidationError)');
  });

  it('redacts, flattens, and truncates ordinary errors', () => {
    const message = safeErrorMessage(new Error(`fetch failed\nfor token-abcdefgh-1234 ${'x'.repeat(400)}`), ['token-abcdefgh-1234']);
    expect(message).not.toContain('token-abcdefgh-1234');
    expect(message).not.toContain('\n');
    expect(message.length).toBeLessThanOrEqual(300);
    expect(message.endsWith('…')).toBe(true);
    expect(safeErrorMessage('plain string failure')).toBe('plain string failure');
    expect(safeErrorMessage({ unexpected: true })).toBe('Unknown error');
  });
});
