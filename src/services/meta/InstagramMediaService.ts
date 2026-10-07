import { MetaGraphError } from '@/lib/meta-errors';
import { isMetaGraphUrl, metaGraphApiVersion, metaGraphUrl } from '@/lib/meta-graph';

export interface InstagramMediaItem {
  id: string;
  media_type: 'REEL' | 'IMAGE' | 'CAROUSEL_ALBUM' | 'VIDEO';
  media_product_type?: 'AD' | 'FEED' | 'STORY' | 'REELS';
  caption?: string;
  permalink?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  children?: { data?: Array<{ id: string; media_type?: string; media_url?: string; thumbnail_url?: string }> };
}

/**
 * Graph API returns Reels as `media_type: VIDEO` with `media_product_type: REELS`
 * (verified against the IG Media reference). Normalising here means the Library
 * can label and play Reels correctly instead of treating them as plain videos.
 */
export function normalizeMediaType(item: InstagramMediaItem): string {
  if (item.media_product_type === 'REELS') return 'REEL';
  return item.media_type;
}

/**
 * For a CAROUSEL_ALBUM the parent has no usable thumbnail for video-first
 * albums, and for copyright-flagged Reels Graph omits `media_url` entirely.
 * Falling back to the first child keeps a real cover image on the card instead
 * of rendering the blank placeholder.
 */
export function resolveDisplayUrls(item: InstagramMediaItem): { mediaUrl: string | null; thumbnailUrl: string | null } {
  const firstChild = item.children?.data?.[0];
  const mediaUrl = item.media_url || firstChild?.media_url || null;
  const thumbnailUrl = item.thumbnail_url || firstChild?.thumbnail_url || (item.media_type !== 'VIDEO' ? firstChild?.media_url || null : null);
  return { mediaUrl, thumbnailUrl };
}

export class InstagramMediaService {
  public static async fetchMedia(instagramAccountId: string, accessToken: string): Promise<InstagramMediaItem[]> {
    const version = metaGraphApiVersion();
    if (!accessToken) throw new Error('Meta Graph API is not configured');
    const fields = [
      'id',
      'media_type',
      'media_product_type',
      'caption',
      'permalink',
      'media_url',
      'thumbnail_url',
      'timestamp',
      'children{id,media_type,media_url,thumbnail_url}',
    ].join(',');

    let nextUrl: string | null = metaGraphUrl(
      version,
      `/${encodeURIComponent(instagramAccountId)}/media?fields=${encodeURIComponent(fields)}&limit=50`,
    );
    const collected = new Map<string, InstagramMediaItem>();

    // Four pages covers 200 recent posts while keeping dashboard sync bounded.
    for (let page = 0; nextUrl && page < 4; page += 1) {
      const url: URL = new URL(nextUrl);
      if (!isMetaGraphUrl(nextUrl)) {
        throw new Error('Meta returned an invalid pagination URL');
      }
      // Never trust or forward a token embedded in a paging URL; use the header.
      url.searchParams.delete('access_token');
      const response: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      });
      const data: any = await response.json();
      if (!response.ok) {
        throw new MetaGraphError(data?.error, 'Unable to fetch Instagram media', response.status);
      }
      for (const item of data.data || []) {
        if (item && typeof item.id === 'string') collected.set(item.id, item as InstagramMediaItem);
      }
      nextUrl = typeof data.paging?.next === 'string' ? data.paging.next : null;
    }

    return [...collected.values()];
  }
}
