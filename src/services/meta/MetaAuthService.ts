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
  private static configId = process.env.META_CONFIG_ID || '';

  public static getOAuthUrl(state: string, customRedirectUri?: string): string {
    const redirect = customRedirectUri || this.redirectUri;

    // Use explicit scopes (NOT config_id) — Business Login config_id causes
    // /me/accounts to return empty pages. Standard scope-based login works correctly.
    const scopes = [
      'instagram_basic',
      'instagram_manage_comments',
      'instagram_manage_messages',
      'pages_show_list',
      'pages_read_engagement',
      'pages_messaging',
    ].join(',');

    return `https://www.facebook.com/${this.graphApiVersion}/dialog/oauth?client_id=${this.appId}&redirect_uri=${encodeURIComponent(
      redirect
    )}&scope=${scopes}&response_type=code&state=${state}`;
  }

  public static async handleOAuthCallback(code: string, customRedirectUri?: string): Promise<ConnectedInstagramAccount> {
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

    const redirect = customRedirectUri || this.redirectUri;

    // 1. Exchange auth code for short-lived user access token
    const tokenUrl = `https://graph.facebook.com/${this.graphApiVersion}/oauth/access_token?client_id=${this.appId}&redirect_uri=${encodeURIComponent(
      redirect
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

    // 3. Try Strategy A: Fetch via Facebook Pages → Instagram Business Account
    const pagesUrl = `https://graph.facebook.com/${this.graphApiVersion}/me/accounts?fields=id,name,instagram_business_account{id,username,profile_picture_url}&access_token=${longLivedToken}`;
    const pagesRes = await fetch(pagesUrl);
    const pagesData = await pagesRes.json();

    if (pagesRes.ok && pagesData.data && pagesData.data.length > 0) {
      const pageWithIg = pagesData.data.find((p: any) => p.instagram_business_account?.id);
      if (pageWithIg) {
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

    // 4. Strategy B: Try fetching Instagram accounts directly linked to user
    const igAccountsUrl = `https://graph.facebook.com/${this.graphApiVersion}/me?fields=id,name,instagram_business_account{id,username,profile_picture_url}&access_token=${longLivedToken}`;
    const igRes = await fetch(igAccountsUrl);
    const igData = await igRes.json();

    if (igRes.ok && igData.instagram_business_account?.id) {
      const igAccount = igData.instagram_business_account;
      return {
        instagramAccountId: igAccount.id,
        instagramUsername: igAccount.username || 'instagram_account',
        profilePictureUrl: igAccount.profile_picture_url,
        facebookPageId: igData.id,
        accessToken: longLivedToken,
        expiresInSeconds: llData.expires_in || 5184000,
      };
    }

    // 5. Strategy C: Try /me/accounts with different fields  
    const igUserUrl = `https://graph.facebook.com/${this.graphApiVersion}/me/instagram_accounts?fields=id,username,profile_picture_url&access_token=${longLivedToken}`;
    const igUserRes = await fetch(igUserUrl);
    const igUserData = await igUserRes.json();

    if (igUserRes.ok && igUserData.data && igUserData.data.length > 0) {
      const igAccount = igUserData.data[0];
      return {
        instagramAccountId: igAccount.id,
        instagramUsername: igAccount.username || 'instagram_account',
        profilePictureUrl: igAccount.profile_picture_url,
        facebookPageId: undefined,
        accessToken: longLivedToken,
        expiresInSeconds: llData.expires_in || 5184000,
      };
    }

    // All strategies failed - throw detailed error
    const debugInfo = {
      pagesStatus: pagesRes.status,
      pagesData: pagesData,
      igDirectStatus: igRes.status,
      igDirectData: igData,
      igUserStatus: igUserRes.status,
      igUserData: igUserData,
    };
    throw new Error(`Instagram account not found. All strategies failed. Debug: ${JSON.stringify(debugInfo)}`);
  }
}
