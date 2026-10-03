import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_STATS_REFRESH_EVENT, requestStudioStatsRefresh, subscribeToStudioStatsRefresh } from './studio-refresh';

class FakeDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

let fakeDocument: FakeDocument;
let clock = 10_000;
const now = () => clock;

function pageShow(persisted: boolean) {
  return Object.assign(new Event('pageshow'), { persisted });
}

beforeEach(() => {
  clock = 10_000;
  fakeDocument = new FakeDocument();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', fakeDocument);
});

afterEach(() => vi.unstubAllGlobals());

describe('Studio statistics refresh', () => {
  it('refreshes on explicit requests, focus, becoming visible, and back/forward cache restores', () => {
    const refresh = vi.fn();
    const unsubscribe = subscribeToStudioStatsRefresh(refresh, now);

    requestStudioStatsRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);

    clock += 5_000;
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(2);

    clock += 5_000;
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(3);

    window.dispatchEvent(pageShow(false)); // ordinary first load: already fetched on mount
    window.dispatchEvent(pageShow(true));
    expect(refresh).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it('coalesces focus and visibility firing together and skips hidden tabs, but never skips explicit requests', () => {
    const refresh = vi.fn();
    const unsubscribe = subscribeToStudioStatsRefresh(refresh, now);
    window.dispatchEvent(new Event('focus'));
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event(STUDIO_STATS_REFRESH_EVENT));
    expect(refresh).toHaveBeenCalledTimes(2);

    clock += 5_000;
    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('stops listening after unsubscribe', () => {
    const refresh = vi.fn();
    subscribeToStudioStatsRefresh(refresh, now)();
    requestStudioStatsRefresh();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(pageShow(true));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('notifies Studio in other tabs once, without double-refreshing the current tab', async () => {
    const otherTab = new BroadcastChannel('insta-automation:studio-stats');
    const received = new Promise((resolve) => { otherTab.onmessage = (event) => resolve(event.data); });
    const refresh = vi.fn();
    const unsubscribe = subscribeToStudioStatsRefresh(refresh, now);

    requestStudioStatsRefresh();
    await expect(received).resolves.toMatchObject({ type: 'refresh' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refresh).toHaveBeenCalledTimes(1);

    otherTab.postMessage({ type: 'refresh', source: 'another-tab' });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    otherTab.close();
    unsubscribe();
  });

  it('is a no-op during server rendering', () => {
    vi.stubGlobal('window', undefined);
    expect(() => requestStudioStatsRefresh()).not.toThrow();
    expect(subscribeToStudioStatsRefresh(vi.fn())).toBeTypeOf('function');
  });
});
