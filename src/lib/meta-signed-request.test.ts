import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseMetaSignedRequest } from './meta-signed-request';

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload: string) {
  const encoded = base64url(payload);
  const signature = createHmac('sha256', process.env.META_APP_SECRET!).update(encoded).digest();
  return `${base64url(signature)}.${encoded}`;
}

describe('Meta signed requests', () => {
  it('verifies and parses a valid HMAC-SHA256 request', () => {
    expect(parseMetaSignedRequest(sign(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'meta-user' }))))
      .toEqual({ algorithm: 'HMAC-SHA256', user_id: 'meta-user' });
  });

  it('rejects tampering, malformed JSON, unsupported algorithms, and extra segments', () => {
    const valid = sign(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'meta-user' }));
    expect(parseMetaSignedRequest(`${valid}x`)).toBeNull();
    expect(parseMetaSignedRequest(`${valid}.extra`)).toBeNull();
    expect(parseMetaSignedRequest(sign('not-json'))).toBeNull();
    expect(parseMetaSignedRequest(sign(JSON.stringify({ algorithm: 'none', user_id: 'meta-user' })))).toBeNull();
  });
});
