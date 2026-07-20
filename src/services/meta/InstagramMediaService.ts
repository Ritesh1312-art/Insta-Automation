export interface InstagramMediaItem {
  id: string;
  instagramMediaId: string;
  mediaType: 'REEL' | 'IMAGE' | 'CAROUSEL_ALBUM' | 'VIDEO';
  caption?: string;
  permalink?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  timestamp: Date;
}

export class InstagramMediaService {
  private static graphApiVersion = process.env.META_GRAPH_API_VERSION || 'v19.0';

  public static async fetchAccountMedia(
    instagramAccountId: string,
    accessToken: string
  ): Promise<InstagramMediaItem[]> {
    if (process.env.META_API_MOCK === 'true') {
      console.log('🤖 [META MOCK MODE] Fetching simulated Instagram Media & Reels');
      return [
        {
          id: 'mock_media_reel_a',
          instagramMediaId: '17999887766554401',
          mediaType: 'REEL',
          caption: 'Hanuman Chalisa PDF Download - Comment "HANUMAN" to get the link! 🙏✨',
          permalink: 'https://instagram.com/p/mock_reel_hanuman',
          mediaUrl: 'https://images.unsplash.com/photo-1609137144813-7d9921338f24?auto=format&fit=crop&w=600&q=80',
          thumbnailUrl: 'https://images.unsplash.com/photo-1609137144813-7d9921338f24?auto=format&fit=crop&w=600&q=80',
          timestamp: new Date('2026-07-15T10:00:00Z'),
        },
        {
          id: 'mock_media_reel_b',
          instagramMediaId: '17999887766554402',
          mediaType: 'REEL',
          caption: 'Top 50 ChatGPT AI Prompt Pack - Comment "PROMPT" for instant DM access 🚀🤖',
          permalink: 'https://instagram.com/p/mock_reel_prompt',
          mediaUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
          thumbnailUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
          timestamp: new Date('2026-07-18T14:30:00Z'),
        },
        {
          id: 'mock_media_reel_c',
          instagramMediaId: '17999887766554403',
          mediaType: 'REEL',
          caption: 'Lightroom Color Editing Presets Pack 2026 - Comment anything to get the presets link! 📸✨',
          permalink: 'https://instagram.com/p/mock_reel_presets',
          mediaUrl: 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?auto=format&fit=crop&w=600&q=80',
          thumbnailUrl: 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?auto=format&fit=crop&w=600&q=80',
          timestamp: new Date('2026-07-19T09:15:00Z'),
        },
      ];
    }

    const fields = 'id,media_type,caption,permalink,media_url,thumbnail_url,timestamp';
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${instagramAccountId}/media?fields=${fields}&access_token=${accessToken}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Failed to fetch Instagram media: ${data.error?.message || JSON.stringify(data)}`);
    }

    return (data.data || []).map((item: any) => ({
      id: item.id,
      instagramMediaId: item.id,
      mediaType: item.media_type,
      caption: item.caption,
      permalink: item.permalink,
      mediaUrl: item.media_url,
      thumbnailUrl: item.thumbnail_url || item.media_url,
      timestamp: new Date(item.timestamp),
    }));
  }
}
