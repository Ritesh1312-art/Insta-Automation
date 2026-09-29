function validHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function publicAppUrl(requestUrl?: string) {
  const configured = validHttpsOrigin(process.env.APP_URL);
  if (configured) return configured;

  if (process.env.NODE_ENV !== 'production' && requestUrl) {
    return new URL(requestUrl).origin;
  }
  throw new Error('APP_URL must be configured as a public HTTPS origin');
}

export function metaRedirectUri(requestUrl?: string) {
  const configured = process.env.META_REDIRECT_URI?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) return url.toString();
    } catch {
      // Fall through to the canonical app URL below.
    }
    throw new Error('META_REDIRECT_URI must be a valid HTTPS URL');
  }
  return `${publicAppUrl(requestUrl)}/api/auth/meta/callback`;
}
