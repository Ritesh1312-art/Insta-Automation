/**
 * Validation for the admin-configurable custom UPI QR image URL.
 *
 * The URL is rendered as an <img> in the Settings preview and at checkout, so
 * the Content-Security-Policy `img-src` must allow it. The CSP is never
 * broadened to a blanket `https:`; instead the deployment opts specific image
 * hosts in through the UPI_QR_ALLOWED_IMAGE_HOSTS environment variable
 * (comma-separated hostnames, e.g. "qr.example.com, *.cdn.example.com"), and
 * next.config.js adds exactly those hosts to img-src. Anything else is
 * rejected here, at save time and again when the value is read back, so a
 * stored URL can never silently break the checkout QR under CSP.
 */

const MAX_QR_URL_LENGTH = 2048;

export type QrUrlValidation = { ok: true; url: string } | { ok: false; error: string };

/**
 * Hosts allowed to serve the custom QR image, from
 * UPI_QR_ALLOWED_IMAGE_HOSTS. Entries may be bare hostnames ("qr.example.com"),
 * wildcard hostnames ("*.cdn.example.com"), or full https:// origins; all are
 * normalized to lowercase hostnames. The variable is read at build/deploy time
 * because the CSP is baked into next.config.js.
 */
export function allowedQrImageHosts(envValue = process.env.UPI_QR_ALLOWED_IMAGE_HOSTS): string[] {
  return (envValue || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .map((entry) => entry.replace(/^https:\/\//, '').replace(/\/.*$/, ''))
    .map((entry) => entry.replace(/^\*\./, '*.'))
    .filter((entry) => entry.length > 0 && !entry.includes(' '));
}

function hostMatchesAllowlist(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(2);
      return host === suffix || host.endsWith(`.${suffix}`);
    }
    return host === allowed;
  });
}

/**
 * Accepts an empty value (auto-generated QR), a same-origin local path
 * ("/qr.png" — already covered by CSP 'self'), or an https:// URL whose host
 * is explicitly allowlisted. Rejects http:, other protocols, credential-bearing
 * URLs, and non-allowlisted hosts with an actionable message.
 */
export function validateCustomQrUrl(raw: string): QrUrlValidation {
  const url = raw.trim();
  if (!url) return { ok: true, url: '' };
  if (url.length > MAX_QR_URL_LENGTH) {
    return { ok: false, error: 'Custom QR URL is too long.' };
  }
  // Same-origin local path (covered by CSP 'self'). Reject protocol-relative
  // "//host/path" — that is an external origin, not a local path.
  if (url.startsWith('/') && !url.startsWith('//')) {
    return { ok: true, url };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'Custom QR URL must be a valid HTTPS image URL on an allowlisted host, or a local path like /qr.png.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Custom QR URL must use HTTPS.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Custom QR URL must not contain credentials.' };
  }
  const allowedHosts = allowedQrImageHosts();
  if (!hostMatchesAllowlist(parsed.hostname, allowedHosts)) {
    return {
      ok: false,
      error: allowedHosts.length === 0
        ? `Custom QR URL host "${parsed.hostname}" is not allowlisted. Use a local path like /qr.png, or add the host to the UPI_QR_ALLOWED_IMAGE_HOSTS environment variable (build-time, e.g. "${parsed.hostname}") and redeploy.`
        : `Custom QR URL host "${parsed.hostname}" is not in UPI_QR_ALLOWED_IMAGE_HOSTS (${allowedHosts.join(', ')}).`,
    };
  }
  return { ok: true, url };
}
