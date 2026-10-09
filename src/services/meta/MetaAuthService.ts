import { metaGraphApiVersion, metaGraphUrl } from '@/lib/meta-graph';

export const META_PAGE_WEBHOOK_FIELDS = ['feed', 'messages', 'messaging_postbacks'] as const;
export const META_INSTAGRAM_WEBHOOK_FIELDS = ['comments', 'messages', 'messaging_postbacks'] as const;
export const META_PAGE_SUBSCRIPTION_FIELDS = ['feed', 'messages', 'messaging_postbacks'] as const;


export const META_OAUTH_SCOPES = [
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  // The Instagram messaging endpoint (`POST /{ig-user-id}/messages`, used for
  // private replies to comments) is authorized by the Page token grant, and
  // Meta refuses it with (#230) "Requires pages_messaging permission to manage
  // the object" when this scope is missing — even though the Instagram-side
  // `instagram_manage_messages` permission is granted. Without it every real
  // comment-to-DM send fails.
  'pages_messaging',
  'business_management',
  'public_profile',
] as const;

export interface ConnectedInstagramAccount {
  metaUserId: string;
  instagramAccountId: string;
  instagramUsername: string;
  profilePictureUrl?: string;
  facebookPageId?: string;
  accessToken: string;
  expiresInSeconds?: number;
  webhookSubscriptionWarnings?: string[];
}

/**
 * Subscription failures carry Meta's numeric error code so callers can tell an
 * expired token (190) apart from a missing permission (10) or a transient flake.
 */
export class MetaSubscriptionError extends Error {
  constructor(message: string, public readonly code: number | null, public readonly status: number | null) {
    super(message);
    this.name = 'MetaSubscriptionError';
  }
}

export function isMetaAuthFailure(error: unknown): boolean {
  return error instanceof MetaSubscriptionError && (error.code === 190 || error.code === 102 || error.status === 401);
}

async function graphJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: init?.signal || AbortSignal.timeout(12_000) });
  const data = await response.json();
  return { response, data };
}

export class MetaAuthService {
  private static get config() {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error('Meta OAuth is not configured correctly');
    }
    // Throws when META_GRAPH_API_VERSION is present but malformed.
    return { graphApiVersion: metaGraphApiVersion(), appId, appSecret };
  }

  public static getOAuthUrl(state: string, redirectUri: string): string {
    const { graphApiVersion, appId } = this.config;
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      scope: META_OAUTH_SCOPES.join(','),
      response_type: 'code',
      state,
    });
    return `https://www.facebook.com/${graphApiVersion}/dialog/oauth?${params}`;
  }

  public static async subscribeObject(
    objectId: string,
    fields: readonly string[],
    accessToken: string,
    graphApiVersion: string,
  ) {
    const params = new URLSearchParams({ subscribed_fields: fields.join(',') });
    const { response, data } = await graphJson(
      metaGraphUrl(graphApiVersion, `/${encodeURIComponent(objectId)}/subscribed_apps?${params}`),
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok || data.success !== true) {
      throw new MetaSubscriptionError(
        data.error?.message || `Unable to subscribe ${objectId} to Meta webhooks`,
        typeof data.error?.code === 'number' ? data.error.code : null,
        response.status,
      );
    }
    return data;
  }

  public static async handleOAuthCallback(code: string, redirectUri: string): Promise<ConnectedInstagramAccount> {
    const { graphApiVersion, appId, appSecret } = this.config;
    const tokenParams = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      client_secret: appSecret,
      code,
    });
    const { response: tokenResponse, data: tokenData } = await graphJson(
      metaGraphUrl(graphApiVersion, `/oauth/access_token?${tokenParams}`),
    );
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error?.message || 'Meta token exchange failed');
    }

    const longLivedParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: tokenData.access_token,
    });
    const { response: longLivedResponse, data: longLivedData } = await graphJson(
      metaGraphUrl(graphApiVersion, `/oauth/access_token?${longLivedParams}`),
    );
    const userToken = longLivedResponse.ok && longLivedData.access_token
      ? longLivedData.access_token
      : tokenData.access_token;
    const expiresInSeconds = longLivedResponse.ok
      ? longLivedData.expires_in
      : tokenData.expires_in;

    const { response: userResponse, data: metaUser } = await graphJson(
      metaGraphUrl(graphApiVersion, '/me?fields=id'),
      { headers: { Authorization: `Bearer ${userToken}` } },
    );
    if (!userResponse.ok || !metaUser.id) {
      throw new Error(metaUser.error?.message || 'Unable to identify the authorized Meta user');
    }

    const configuredPageId = process.env.META_FACEBOOK_PAGE_ID?.trim();
    const pageUrl = configuredPageId
      ? metaGraphUrl(graphApiVersion, `/${encodeURIComponent(configuredPageId)}?fields=id,instagram_business_account{id,username,profile_picture_url},access_token`)
      : metaGraphUrl(graphApiVersion, '/me/accounts?fields=id,instagram_business_account{id,username,profile_picture_url},access_token');
    const { response: pagesResponse, data: pagesData } = await graphJson(pageUrl, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const page = configuredPageId
      ? pagesData
      : pagesData.data?.find((candidate: any) => candidate.instagram_business_account?.id && candidate.access_token);
    if (!pagesResponse.ok || !page?.instagram_business_account?.id || !page.access_token) {
      throw new Error(pagesData.error?.message || 'No Facebook Page with a connected Instagram professional account was found');
    }

    const account = page.instagram_business_account;
    const subscriptionAttempts = await Promise.allSettled([
      this.subscribeObject(page.id, META_PAGE_SUBSCRIPTION_FIELDS, page.access_token, graphApiVersion),
    ]);
    const webhookSubscriptionWarnings = subscriptionAttempts
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : 'Unknown subscription error');
    for (const warning of webhookSubscriptionWarnings) {
      console.warn('One Meta webhook subscription target was unavailable:', warning);
    }

    return {
      metaUserId: metaUser.id,
      instagramAccountId: account.id,
      instagramUsername: account.username || account.id,
      profilePictureUrl: account.profile_picture_url,
      facebookPageId: page.id,
      accessToken: page.access_token,
      expiresInSeconds,
      webhookSubscriptionWarnings,
    };
  }
}
