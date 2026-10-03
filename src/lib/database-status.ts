export type DatabaseProvider = 'Neon' | 'Supabase' | 'Prisma Postgres' | 'Railway' | 'Render' | 'Other';
export type DatabaseConnectionMode = 'pooled' | 'direct' | 'unknown';

export interface DatabaseStatus {
  provider: DatabaseProvider;
  connectionMode: DatabaseConnectionMode;
  confidence: 'high' | 'low';
}

const UNKNOWN_STATUS: DatabaseStatus = {
  provider: 'Other',
  connectionMode: 'unknown',
  confidence: 'low',
};

function matchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function providerFor(hostname: string): DatabaseProvider {
  if (matchesDomain(hostname, 'neon.tech')) return 'Neon';
  if (matchesDomain(hostname, 'supabase.co') || matchesDomain(hostname, 'supabase.com')) return 'Supabase';
  if (matchesDomain(hostname, 'db.prisma.io') || matchesDomain(hostname, 'prisma-data.net')) return 'Prisma Postgres';
  if (
    matchesDomain(hostname, 'railway.app')
    || matchesDomain(hostname, 'railway.internal')
    || matchesDomain(hostname, 'rlwy.net')
  ) return 'Railway';
  if (matchesDomain(hostname, 'render.com')) return 'Render';
  return 'Other';
}

function hasPoolerLabel(hostname: string) {
  return hostname.split('.').some((label) => /(?:^|[-_])(?:pool|pooler|pooled|pgbouncer)(?:$|[-_])/.test(label));
}

function explicitMode(url: URL, hostname: string): DatabaseConnectionMode | null {
  const poolerHost = hasPoolerLabel(hostname);
  const directHost = hostname.split('.').some((label) => /(?:^|[-_])(?:direct|unpooled)(?:$|[-_])/.test(label));
  const flags = ['pgbouncer', 'pool', 'pooling'];
  const values = flags.map((key) => url.searchParams.get(key)?.trim().toLowerCase());
  const connectionMode = url.searchParams.get('connection_mode')?.trim().toLowerCase();
  const poolMode = url.searchParams.get('pool_mode')?.trim().toLowerCase();
  const poolerQuery = values.some((value) => ['true', '1', 'yes', 'pooled', 'pooler'].includes(value ?? ''))
    || connectionMode === 'pooled'
    || ['transaction', 'session', 'statement'].includes(poolMode ?? '');
  const directQuery = values.some((value) => ['false', '0', 'no', 'direct'].includes(value ?? ''))
    || connectionMode === 'direct'
    || poolMode === 'direct';

  // Conflicting signals are not strong enough to publish a mode.
  if ((poolerHost || poolerQuery) && (directHost || directQuery)) return 'unknown';
  if (poolerHost || poolerQuery) return 'pooled';
  if (directHost || directQuery) return 'direct';
  return null;
}

/**
 * Infer a small, non-identifying status from a server-side PostgreSQL URL.
 * The URL and its components are deliberately never included in the result or
 * in an error, so callers can safely return the result to an administrator.
 */
export function inferDatabaseStatus(databaseUrl: string | undefined): DatabaseStatus {
  if (!databaseUrl) return UNKNOWN_STATUS;

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return UNKNOWN_STATUS;
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return UNKNOWN_STATUS;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) return UNKNOWN_STATUS;

  const provider = providerFor(hostname);
  const signaledMode = explicitMode(url, hostname);

  if (signaledMode === 'unknown') {
    return { provider, connectionMode: 'unknown', confidence: 'low' };
  }

  if (signaledMode) {
    return {
      provider,
      connectionMode: signaledMode,
      confidence: provider === 'Other' ? 'low' : 'high',
    };
  }

  // These provider URL shapes distinguish their standard direct endpoint from
  // their pooler endpoint. Providers without a reliable URL-level distinction
  // remain unknown rather than being guessed.
  if (provider === 'Neon' || provider === 'Supabase') {
    return { provider, connectionMode: 'direct', confidence: 'high' };
  }
  if (provider === 'Railway' || provider === 'Render') {
    return { provider, connectionMode: 'direct', confidence: 'high' };
  }

  return { provider, connectionMode: 'unknown', confidence: 'low' };
}
