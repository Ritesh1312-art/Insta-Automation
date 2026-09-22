import { MetaGraphError } from '@/lib/meta-errors';

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
    const version = process.env.META_GRAPH_API_VERSION;
    if (!version || !accessToken) throw new Error('Meta Graph API is not configured');
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

    const response = await fetch(
      `https://graph.facebook.com/${version}/${instagramAccountId}/media?fields=${encodeURIComponent(fields)}&limit=50`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
    );
    const data = await response.json();
    if (!response.ok) {
      // Preserve code/subcode so callers can tell "token dead, reconnect" from
      // "Meta is having a bad day, keep serving cache".
      throw new MetaGraphError(data?.error, 'Unable to fetch Instagram media', response.status);
    }
    return (data.data || []).filter((item: unknown): item is InstagramMediaItem => Boolean(item && typeof (item as InstagramMediaItem).id === 'string'));
  }
}
