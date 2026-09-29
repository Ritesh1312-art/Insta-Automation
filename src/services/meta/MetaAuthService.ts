export const META_PAGE_WEBHOOK_FIELDS = ['messages', 'messaging_postbacks', 'feed'] as const;
export const META_REQUIRED_SCOPES = [
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
] as const;

export interface ConnectedInstagramAccount {
  metaUserId: string;
  instagramAccountId: string;
  instagramUsername: string;
  profilePictureUrl?: string;
  facebookPageId: string;
  accessToken: string;
  scopes: string[];
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
    const scopes = [...META_REQUIRED_SCOPES, 'business_management', 'public_profile'].join(',');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      scope: scopes,
      response_type: 'code',
      state,
    });
    return `https://www.facebook.com/${graphApiVersion}/dialog/oauth?${params.toString()}`;
  }

  public static async handleOAuthCallback(code: string, redirectUri: string): Promise<ConnectedInstagramAccount> {
    const { graphApiVersion, appId, appSecret } = this.config;

    const tokenParams = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, client_secret: appSecret, code });
    const tokenResponse = await fetch(`https://graph.facebook.com/${graphApiVersion}/oauth/access_token?${tokenParams.toString()}`, { cache: 'no-store' });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error?.message || 'Meta token exchange failed');

    const longLivedParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: tokenData.access_token,
    });
    const longLivedResponse = await fetch(`https://graph.facebook.com/${graphApiVersion}/oauth/access_token?${longLivedParams.toString()}`, { cache: 'no-store' });
    const longLivedData = await longLivedResponse.json();
    if (!longLivedResponse.ok || !longLivedData.access_token) {
      throw new Error(longLivedData.error?.message || 'Unable to obtain a long-lived Meta access token');
    }
    const userToken = longLivedData.access_token;

    const [userResponse, permissionsResponse] = await Promise.all([
      fetch(`https://graph.facebook.com/${graphApiVersion}/me?fields=id`, {
        headers: { Authorization: `Bearer ${userToken}` }, cache: 'no-store',
      }),
      fetch(`https://graph.facebook.com/${graphApiVersion}/me/permissions`, {
        headers: { Authorization: `Bearer ${userToken}` }, cache: 'no-store',
      }),
    ]);
    const metaUser = await userResponse.json();
    const permissionsData = await permissionsResponse.json();
    if (!userResponse.ok || !metaUser.id) throw new Error(metaUser.error?.message || 'Unable to identify the authorized Meta user');
    if (!permissionsResponse.ok) throw new Error(permissionsData.error?.message || 'Unable to verify Meta permissions');

    const grantedScopes = (permissionsData.data || [])
      .filter((permission: { status?: string }) => permission.status === 'granted')
      .map((permission: { permission?: string }) => permission.permission)
      .filter((permission: unknown): permission is string => typeof permission === 'string');
    const missingScopes = META_REQUIRED_SCOPES.filter((scope) => !grantedScopes.includes(scope));
    if (missingScopes.length) throw new Error(`Required Meta permissions were not granted: ${missingScopes.join(', ')}`);

    const configuredPageId = process.env.META_FACEBOOK_PAGE_ID?.trim();
    const pageUrl = configuredPageId
      ? `https://graph.facebook.com/${graphApiVersion}/${configuredPageId}?fields=id,instagram_business_account{id,username,profile_picture_url},access_token`
      : `https://graph.facebook.com/${graphApiVersion}/me/accounts?fields=id,name,instagram_business_account{id,username,profile_picture_url},access_token&limit=100`;

    const pagesResponse = await fetch(pageUrl, { headers: { Authorization: `Bearer ${userToken}` }, cache: 'no-store' });
    const pagesData = await pagesResponse.json();
    if (!pagesResponse.ok) throw new Error(pagesData.error?.message || 'Unable to load Facebook Pages');
    const page = configuredPageId
      ? pagesData
      : pagesData.data?.find((candidate: { instagram_business_account?: { id?: string }; access_token?: string }) => candidate.instagram_business_account?.id && candidate.access_token);
    if (!page?.instagram_business_account?.id || !page.access_token || !page.id) {
      throw new Error('No Facebook Page with a connected Instagram professional account was found');
    }

    // Installing the app on the linked Page is required for production webhook
    // delivery. `feed` is the non-Instagram Page field used during installation;
    // Instagram `comments` is configured on the Instagram Webhooks object.
    const subscriptionParams = new URLSearchParams({ subscribed_fields: META_PAGE_WEBHOOK_FIELDS.join(',') });
    const subResponse = await fetch(
      `https://graph.facebook.com/${graphApiVersion}/${page.id}/subscribed_apps?${subscriptionParams.toString()}`,
      { method: 'POST', headers: { Authorization: `Bearer ${page.access_token}` }, cache: 'no-store' },
    );
    const subData = await subResponse.json();
    if (!subResponse.ok || subData.success !== true) {
      throw new Error(subData.error?.message || 'Unable to subscribe the Facebook Page to Meta webhooks');
    }

    const account = page.instagram_business_account;
    return {
      metaUserId: metaUser.id,
      instagramAccountId: account.id,
      instagramUsername: account.username || account.id,
      profilePictureUrl: account.profile_picture_url,
      facebookPageId: page.id,
      accessToken: page.access_token,
      scopes: grantedScopes,
      expiresInSeconds: longLivedData.expires_in,
    };
  }
}
