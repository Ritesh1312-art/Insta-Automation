import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

describe('request proxy security', () => {
  it('rejects cross-site state-changing API requests', async () => {
    const request = new NextRequest('https://app.example.com/api/automations', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    const response = proxy(request);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Cross-site request rejected' });
  });

  it('allows signed external webhook POSTs to reach their route', () => {
    const request = new NextRequest('https://app.example.com/api/webhooks/meta', { method: 'POST' });
    expect(proxy(request).status).toBe(200);
  });

  it('redirects unauthenticated dashboard navigation and allows a session cookie', () => {
    const anonymous = proxy(new NextRequest('https://app.example.com/dashboard'));
    expect(anonymous.status).toBe(307);
    expect(anonymous.headers.get('location')).toBe('https://app.example.com/login');

    const authenticated = proxy(new NextRequest('https://app.example.com/dashboard', {
      headers: { cookie: 'auth_token=signed' },
    }));
    expect(authenticated.status).toBe(200);
  });
});
