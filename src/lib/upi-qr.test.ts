import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedQrImageHosts, validateCustomQrUrl } from './upi-qr';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('allowedQrImageHosts', () => {
  it('parses comma-separated hostnames and normalizes them', () => {
    expect(allowedQrImageHosts(' QR.Example.COM , https://cdn.example.com/path ,*.Static.Example.com ')).toEqual([
      'qr.example.com',
      'cdn.example.com',
      '*.static.example.com',
    ]);
  });

  it('returns an empty list when unset', () => {
    expect(allowedQrImageHosts(undefined)).toEqual([]);
    expect(allowedQrImageHosts('  ')).toEqual([]);
  });
});

describe('validateCustomQrUrl', () => {
  it('accepts an empty value (auto-generated QR)', () => {
    expect(validateCustomQrUrl('')).toEqual({ ok: true, url: '' });
    expect(validateCustomQrUrl('   ')).toEqual({ ok: true, url: '' });
  });

  it('accepts same-origin local paths (covered by CSP self)', () => {
    expect(validateCustomQrUrl('/qr.png')).toEqual({ ok: true, url: '/qr.png' });
    expect(validateCustomQrUrl('/images/upi/qr.png?v=2')).toEqual({ ok: true, url: '/images/upi/qr.png?v=2' });
  });

  it('rejects protocol-relative and non-URL values', () => {
    expect(validateCustomQrUrl('//evil.example.com/qr.png').ok).toBe(false);
    expect(validateCustomQrUrl('qr.png').ok).toBe(false);
    expect(validateCustomQrUrl('ftp://example.com/qr.png').ok).toBe(false);
  });

  it('rejects http: even on an allowlisted host (CSP would not match and it is insecure)', () => {
    vi.stubEnv('UPI_QR_ALLOWED_IMAGE_HOSTS', 'qr.example.com');
    const result = validateCustomQrUrl('http://qr.example.com/qr.png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('HTTPS');
  });

  it('rejects hosts outside the allowlist with actionable guidance', () => {
    vi.stubEnv('UPI_QR_ALLOWED_IMAGE_HOSTS', 'qr.example.com');
    const result = validateCustomQrUrl('https://evil.example.com/qr.png');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('evil.example.com');
      expect(result.error).toContain('UPI_QR_ALLOWED_IMAGE_HOSTS');
    }
  });

  it('rejects any external host when the allowlist is empty', () => {
    vi.stubEnv('UPI_QR_ALLOWED_IMAGE_HOSTS', '');
    const result = validateCustomQrUrl('https://qr.example.com/qr.png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('UPI_QR_ALLOWED_IMAGE_HOSTS');
  });

  it('accepts exact and wildcard allowlisted hosts over https', () => {
    vi.stubEnv('UPI_QR_ALLOWED_IMAGE_HOSTS', 'qr.example.com, *.cdn.example.com');
    expect(validateCustomQrUrl('https://qr.example.com/qr.png')).toEqual({ ok: true, url: 'https://qr.example.com/qr.png' });
    expect(validateCustomQrUrl('https://cdn.example.com/qr.png').ok).toBe(true);
    expect(validateCustomQrUrl('https://a.b.cdn.example.com/qr.png').ok).toBe(true);
    // Wildcard must not match the bare suffix or unrelated hosts.
    expect(validateCustomQrUrl('https://notcdn.example.com/qr.png').ok).toBe(false);
    expect(validateCustomQrUrl('https://example.com/qr.png').ok).toBe(false);
  });

  it('rejects credential-bearing URLs', () => {
    vi.stubEnv('UPI_QR_ALLOWED_IMAGE_HOSTS', 'qr.example.com');
    expect(validateCustomQrUrl('https://user:pass@qr.example.com/qr.png').ok).toBe(false);
  });

  it('rejects absurdly long URLs', () => {
    expect(validateCustomQrUrl(`https://example.com/${'a'.repeat(3000)}`).ok).toBe(false);
  });
});

describe('next.config.js CSP wiring for custom QR hosts', () => {
  async function imgSrcDirective(hosts?: string) {
    vi.resetModules();
    if (hosts === undefined) delete process.env.UPI_QR_ALLOWED_IMAGE_HOSTS;
    else process.env.UPI_QR_ALLOWED_IMAGE_HOSTS = hosts;
    const config = (await import('../../next.config.js')).default as {
      headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>;
    };
    const entries = await config.headers();
    const csp = entries[0].headers.find((header) => header.key === 'Content-Security-Policy')?.value || '';
    const match = csp.match(/img-src ([^;]+)/);
    expect(match).not.toBeNull();
    return match![1];
  }

  it('keeps img-src narrow when no hosts are configured', async () => {
    const imgSrc = await imgSrcDirective(undefined);
    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain('https://*.cdninstagram.com');
    // No blanket https: token — arbitrary external images stay blocked.
    expect(imgSrc.split(/\s+/)).not.toContain('https:');
  });

  it('adds exactly the allowlisted hosts to img-src', async () => {
    const imgSrc = await imgSrcDirective('qr.example.com, *.cdn.example.com');
    expect(imgSrc).toContain('https://qr.example.com');
    expect(imgSrc).toContain('https://*.cdn.example.com');
    // Never a blanket https: — arbitrary external images stay blocked.
    expect(imgSrc).not.toMatch(/(^|\s)https:(\s|$)/);
  });
});
