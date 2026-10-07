import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { META_OAUTH_SCOPES, MetaAuthService } from './MetaAuthService';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  process.env.META_APP_ID = 'app-id';
  process.env.META_APP_SECRET = 'app-secret';
  process.env.META_GRAPH_API_VERSION = 'v21.0';
  delete process.env.META_FACEBOOK_PAGE_ID;
});
afterEach(() => vi.unstubAllGlobals());

describe('MetaAuthService', () => {
  it('creates an encoded OAuth URL with all required permissions and state', () => {
    const url = new URL(MetaAuthService.getOAuthUrl('signed state', 'https://app.example.com/api/auth/meta/callback'));
    expect(url.origin).toBe('https://www.facebook.com');
    expect(url.searchParams.get('client_id')).toBe('app-id');
    expect(url.searchParams.get('state')).toBe('signed state');
    const scopes = url.searchParams.get('scope')?.split(',');
    expect(scopes).toEqual([...META_OAUTH_SCOPES]);
    expect(scopes).toContain('pages_manage_metadata');
  });

  it('exchanges tokens, discovers the Instagram account, and subscribes both webhook objects', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: 'short', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ access_token: 'long', expires_in: 5_000_000 }))
      .mockResolvedValueOnce(json({ id: 'meta-user' }))
      .mockResolvedValueOnce(json({ data: [{
        id: 'page-id', access_token: 'page-token',
        instagram_business_account: { id: 'ig-id', username: 'creator', profile_picture_url: 'https://cdn.example/p.jpg' },
      }] }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const account = await MetaAuthService.handleOAuthCallback('code', 'https://app.example.com/api/auth/meta/callback');
    expect(account).toMatchObject({
      metaUserId: 'meta-user', instagramAccountId: 'ig-id', facebookPageId: 'page-id',
      instagramUsername: 'creator', accessToken: 'page-token', expiresInSeconds: 5_000_000,
      webhookSubscriptionWarnings: [],
      // Callers store the per-target outcome, so it must be reported even when
      // everything succeeded.
      webhookSubscription: { page: true, instagram: true },
    });
    expect(String(fetchMock.mock.calls[4][0])).toContain('/page-id/subscribed_apps');
    expect(String(fetchMock.mock.calls[4][0])).toContain('feed%2Cmessages%2Cmessaging_postbacks');
    expect(String(fetchMock.mock.calls[5][0])).toContain('/ig-id/subscribed_apps');
    expect(String(fetchMock.mock.calls[5][0])).toContain('comments%2Cmessages%2Cmessaging_postbacks');
  });

  it('keeps a valid connection when one webhook object is unavailable and reports a warning', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ access_token: 'short' }))
      .mockResolvedValueOnce(json({ error: { message: 'No long token' } }, 400))
      .mockResolvedValueOnce(json({ id: 'meta-user' }))
      .mockResolvedValueOnce(json({ data: [{
        id: 'page-id', access_token: 'page-token', instagram_business_account: { id: 'ig-id', username: 'creator' },
      }] }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ error: { message: 'Instagram subscription unavailable' } }, 400)));

    const account = await MetaAuthService.handleOAuthCallback('code', 'https://app.example.com/callback');
    expect(account.accessToken).toBe('page-token');
    expect(account.webhookSubscriptionWarnings).toEqual(['Instagram subscription unavailable']);
    // The valid token is reported as accepted; only the Instagram subscription failed.
    expect(account.webhookSubscription).toEqual({ page: true, instagram: false });
  });

  it('rejects OAuth when no professional Instagram account is connected', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ access_token: 'token' }))
      .mockResolvedValueOnce(json({ access_token: 'long' }))
      .mockResolvedValueOnce(json({ id: 'meta-user' }))
      .mockResolvedValueOnce(json({ data: [] })));
    await expect(MetaAuthService.handleOAuthCallback('code', 'https://app.example.com/callback'))
      .rejects.toThrow('No Facebook Page');
  });
});
