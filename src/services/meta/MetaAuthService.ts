import { encryptToken } from '@/lib/encryption';

export interface ConnectedInstagramAccount {
  instagramAccountId: string;
  instagramUsername: string;
  profilePictureUrl?: string;
  facebookPageId?: string;
  accessToken: string;
  expiresInSeconds?: number;
}

export class MetaAuthService {
  private static graphApiVersion = process.env.META_GRAPH_API_VERSION || 'v19.0';
  private static appId = process.env.META_APP_ID || '';
  private static appSecret = process.env.META_APP_SECRET || '';
  private static redirectUri = process.env.META_REDIRECT_URI || 'http://localhost:3000/api/auth/meta/callback';

  public static getOAuthUrl(state: string): string {
    const scopes = [
      'instagram_basic',
      'instagram_manage_comments',
      'instagram_manage_messages',
      'pages_read_engagement',
      'pages_show_list',
      'pages_manage_metadata',
    ].join(',');

    return `https://www.facebook.com/${this.graphApiVersion}/dialog/oauth?client_id=${this.appId}&redirect_uri=${encodeURIComponent(
      this.redirectUri
    )}&scope=${scopes}&response_type=code&state=${state}`;
  }

  public static async handleOAuthCallback(code: string): Promise<ConnectedInstagramAccount> {
    if (process.env.META_API_MOCK === 'true') {
      console.log('🤖 [META MOCK MODE] Simulating Meta OAuth Callback Exchange');
      return {
        instagramAccountId: 'ig_mock_17841400000000001',
        instagramUsername: 'ritesh_tech_creator',
        profilePictureUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=250&q=80',
        facebookPageId: 'fb_mock_page_99887766',
        accessToken: 'mock_long_lived_access_token_xyz987654321',
        expiresInSeconds: 5184000, // 60 days
      };
    }

    // 1. Exchange auth code for short-lived user access token
    const tokenUrl = `https://graph.facebook.com/${this.graphApiVersion}/oauth/access_token?client_id=${this.appId}&redirect_uri=${encodeURIComponent(
      this.redirectUri
    )}&client_secret=${this.appSecret}&code=${code}`;

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(`Meta Token Exchange Failed: ${tokenData.error?.message || JSON.stringify(tokenData)}`);
    }

    // 2. Exchange short-lived token for 60-day long-lived access token
    const longLivedUrl = `https://graph.facebook.com/${this.graphApiVersion}/oauth/access_token?grant_type=fb_exchange_token&client_id=${this.appId}&client_secret=${this.appSecret}&fb_exchange_token=${tokenData.access_token}`;
    const llRes = await fetch(longLivedUrl);
    const llData = await llRes.json();
    const longLivedToken = llData.access_token || tokenData.access_token;

    // 3. Fetch Facebook Pages and connected Instagram Business Accounts
    const pagesUrl = `https://graph.facebook.com/${this.graphApiVersion}/me/accounts?fields=id,name,instagram_business_account{id,username,profile_picture_url}&access_token=${longLivedToken}`;
    const pagesRes = await fetch(pagesUrl);
    const pagesData = await pagesRes.json();

    if (!pagesRes.ok || !pagesData.data || pagesData.data.length === 0) {
      throw new Error('No Facebook Pages found or permission missing to read Page details.');
    }

    const pageWithIg = pagesData.data.find((p: any) => p.instagram_business_account?.id);
    if (!pageWithIg) {
      throw new Error('No Instagram Professional Account connected to your Facebook Page.');
    }

    const igAccount = pageWithIg.instagram_business_account;

    return {
      instagramAccountId: igAccount.id,
      instagramUsername: igAccount.username || 'instagram_account',
      profilePictureUrl: igAccount.profile_picture_url,
      facebookPageId: pageWithIg.id,
      accessToken: longLivedToken,
      expiresInSeconds: llData.expires_in || 5184000,
    };
  }
}
