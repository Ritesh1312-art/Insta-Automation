import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramMediaService, normalizeMediaType, resolveDisplayUrls } from './InstagramMediaService';
import { MetaGraphError } from '@/lib/meta-errors';
import { metaGraphApiVersion, metaGraphBaseUrl } from '@/lib/meta-graph';

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('InstagramMediaService', () => {
  it('normalizes Reels and carousel display URLs', () => {
    expect(normalizeMediaType({ id: '1', media_type: 'VIDEO', media_product_type: 'REELS', timestamp: '2026-01-01' })).toBe('REEL');
    expect(resolveDisplayUrls({
      id: '2', media_type: 'CAROUSEL_ALBUM', timestamp: '2026-01-01',
      children: { data: [{ id: 'child', media_type: 'IMAGE', media_url: 'https://cdn.example/child.jpg' }] },
    })).toEqual({ mediaUrl: 'https://cdn.example/child.jpg', thumbnailUrl: 'https://cdn.example/child.jpg' });
  });

  it('paginates, deduplicates, strips paging tokens, and authenticates by header', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        data: [{ id: 'one', media_type: 'IMAGE', timestamp: '2026-01-01' }],
        paging: { next: `${metaGraphBaseUrl()}/${metaGraphApiVersion()}/ig/media?after=x&access_token=leak` },
      }))
      .mockResolvedValueOnce(response({
        data: [
          { id: 'one', media_type: 'IMAGE', timestamp: '2026-01-01' },
          { id: 'two', media_type: 'VIDEO', timestamp: '2026-01-02' },
        ],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const items = await InstagramMediaService.fetchMedia('ig', 'safe-token');
    expect(items.map((item) => item.id)).toEqual(['one', 'two']);
    const secondUrl = fetchMock.mock.calls[1][0] as URL;
    expect(secondUrl.searchParams.has('access_token')).toBe(false);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer safe-token');
  });

  it('rejects untrusted pagination hosts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      data: [], paging: { next: 'https://evil.example/steal' },
    })));
    await expect(InstagramMediaService.fetchMedia('ig', 'token')).rejects.toThrow('invalid pagination URL');
  });

  it('preserves Meta error codes for token reauthorization decisions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      error: { code: 190, error_subcode: 463, message: 'Token expired' },
    }, 401)));
    const promise = InstagramMediaService.fetchMedia('ig', 'token');
    await expect(promise).rejects.toBeInstanceOf(MetaGraphError);
    await expect(promise).rejects.toMatchObject({ code: 190, subcode: 463, requiresReauthorization: true });
  });
});
