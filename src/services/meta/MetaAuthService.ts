export interface ConnectedInstagramAccount {
  metaUserId: string;
  instagramAccountId: string;
  instagramUsername: string;
  profilePictureUrl?: string;
  facebookPageId?: string;
  accessToken: string;
  expiresInSeconds?: number;
}

export class MetaAuthService {
  private static get config() {
    const graphApiVersion = process.env.META_GRAPH_API_VERSION;
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!graphApiVersion || !appId || !appSecret) throw new Error('Meta OAuth is not configured');
    return { graphApiVersion, appId, appSecret };
  }

  public static getOAuthUrl(state: string, redirectUri: string): string {
    const { graphApiVersion, appId } = this.config;
    const scopes = ['instagram_basic', 'instagram_manage_comments', 'instagram_manage_messages', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'business_management'].join(',');
    return `https://www.facebook.com/${graphApiVersion}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code&state=${encodeURIComponent(state)}`;
  }

  public static async handleOAuthCallback(code: string, redirectUri: string): Promise<ConnectedInstagramAccount> {
    const { graphApiVersion, appId, appSecret } = this.config;

    const tokenResponse = await fetch(`https://graph.facebook.com/${graphApiVersion}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`, { cache: 'no-store' });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error?.message || 'Meta token exchange failed');

    const longLivedResponse = await fetch(`https://graph.facebook.com/${graphApiVersion}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`, { cache: 'no-store' });
    const longLivedData = await longLivedResponse.json();
    const userToken = longLivedData.access_token || tokenData.access_token;

    const userResponse = await fetch(`https://graph.facebook.com/${graphApiVersion}/me?fields=id`, {
      headers: { Authorization: `Bearer ${userToken}` },
      cache: 'no-store',
    });
    const metaUser = await userResponse.json();
    if (!userResponse.ok || !metaUser.id) {
      throw new Error(metaUser.error?.message || 'Unable to identify the authorized Meta user');
    }

    const pageId = process.env.META_FACEBOOK_PAGE_ID;
    const pageUrl = pageId
      ? `https://graph.facebook.com/${graphApiVersion}/${pageId}?fields=id,instagram_business_account{id,username,profile_picture_url},access_token`
      : `https://graph.facebook.com/${graphApiVersion}/me/accounts?fields=id,instagram_business_account{id,username,profile_picture_url},access_token`;

    const pagesResponse = await fetch(pageUrl, { headers: { Authorization: `Bearer ${userToken}` }, cache: 'no-store' });
    const pagesData = await pagesResponse.json();
    const page = pageId ? pagesData : pagesData.data?.find((candidate: any) => candidate.instagram_business_account?.id && candidate.access_token);
    if (!pagesResponse.ok || !page?.instagram_business_account?.id || !page.access_token) {
      throw new Error(pagesData.error?.message || 'No Facebook Page with a connected Instagram professional account was found');
    }

    const account = page.instagram_business_account;
    return {
      metaUserId: metaUser.id,
      instagramAccountId: account.id,
      instagramUsername: account.username || account.id,
      profilePictureUrl: account.profile_picture_url,
      facebookPageId: page.id,
      accessToken: page.access_token,
      expiresInSeconds: longLivedData.expires_in,
    };
  }
}
