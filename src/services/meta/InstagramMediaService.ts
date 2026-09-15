export interface InstagramMediaItem {
  id: string;
  media_type: 'REEL' | 'IMAGE' | 'CAROUSEL_ALBUM' | 'VIDEO';
  caption?: string;
  permalink?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
}

export class InstagramMediaService {
  public static async fetchMedia(instagramAccountId: string, accessToken: string): Promise<InstagramMediaItem[]> {
    const version = process.env.META_GRAPH_API_VERSION;
    if (!version || !accessToken) throw new Error('Meta Graph API is not configured');
    const fields = 'id,media_type,caption,permalink,media_url,thumbnail_url,timestamp';
    const response = await fetch(`https://graph.facebook.com/${version}/${instagramAccountId}/media?fields=${fields}&limit=50`, {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Unable to fetch Instagram media');
    return (data.data || []).filter((item: unknown): item is InstagramMediaItem => Boolean(item && typeof (item as InstagramMediaItem).id === 'string'));
  }
}
