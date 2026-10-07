/**
 * Single place that knows where the Meta Graph API lives.
 *
 * Production always talks to https://graph.facebook.com. `META_GRAPH_BASE_URL`
 * exists so the whole Meta surface (OAuth token exchange, subscription, media,
 * messaging and the profile-picture proxy) can be pointed at a local mock in
 * tests and in local development. It is optional and unset by default, so the
 * production behaviour cannot change by accident.
 */

export const DEFAULT_META_GRAPH_BASE_URL = 'https://graph.facebook.com';
export const DEFAULT_META_GRAPH_API_VERSION = 'v26.0';

const GRAPH_VERSION_PATTERN = /^v\d+\.\d+$/;

export function metaGraphBaseUrl(): string {
  const configured = (process.env.META_GRAPH_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!configured) return DEFAULT_META_GRAPH_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('META_GRAPH_BASE_URL must be an absolute http(s) URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('META_GRAPH_BASE_URL must use http or https');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('META_GRAPH_BASE_URL must be a bare origin, without credentials, query or fragment');
  }
  return parsed.origin;
}

export function metaGraphApiVersion(): string {
  const configured = (process.env.META_GRAPH_API_VERSION || '').trim() || DEFAULT_META_GRAPH_API_VERSION;
  if (!GRAPH_VERSION_PATTERN.test(configured)) {
    throw new Error('META_GRAPH_API_VERSION must be a version such as v26.0');
  }
  return configured;
}

/** Builds `<base>/<version><path>`; `path` must start with `/`. */
export function metaGraphUrl(version: string, path: string): string {
  const base = metaGraphBaseUrl();
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/${encodeURIComponent(version)}${suffix}`;
}

/**
 * Guards pagination: Meta returns absolute `paging.next` URLs and only URLs on
 * the configured Graph host may be followed, so a hostile or mistyped response
 * cannot redirect the sync at some other host.
 */
export function isMetaGraphUrl(candidate: string): boolean {
  try {
    return new URL(candidate).origin === metaGraphBaseUrl();
  } catch {
    return false;
  }
}
