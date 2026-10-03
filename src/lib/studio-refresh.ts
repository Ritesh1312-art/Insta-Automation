/**
 * Keeps the Studio statistics fresh in the browser.
 *
 * Studio numbers must match the Flows list, so Studio refetches (always with
 * `cache: 'no-store'`) when it becomes visible again, when the window regains
 * focus, when the page is restored from the back/forward cache, and when
 * another page reports that flows or analytics changed.
 */

export const STUDIO_STATS_REFRESH_EVENT = 'studio-stats:refresh';
const STUDIO_STATS_CHANNEL = 'insta-automation:studio-stats';
/** Focus and visibility often fire together; coalesce passive triggers. */
const PASSIVE_REFRESH_INTERVAL_MS = 1_000;
/** Same-tab requests arrive as a window event; the channel is for other tabs. */
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(STUDIO_STATS_CHANNEL) : null;
  } catch {
    return null;
  }
}

/** Tells any open Studio (this tab or others) that flows or analytics changed. */
export function requestStudioStatsRefresh() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(STUDIO_STATS_REFRESH_EVENT));
  const channel = openChannel();
  if (channel) {
    channel.postMessage({ type: 'refresh', source: TAB_ID });
    channel.close();
  }
}

/**
 * Calls `refresh` whenever Studio data may be stale. Explicit refresh requests
 * always run; passive triggers (focus, visibility, back/forward restore) are
 * coalesced. Returns an unsubscribe function for `useEffect` cleanup.
 */
export function subscribeToStudioStatsRefresh(refresh: () => void, now: () => number = Date.now) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;

  let lastPassiveRefresh = Number.NEGATIVE_INFINITY;
  const passive = () => {
    if (document.visibilityState === 'hidden') return;
    const current = now();
    if (current - lastPassiveRefresh < PASSIVE_REFRESH_INTERVAL_MS) return;
    lastPassiveRefresh = current;
    refresh();
  };
  const explicit = () => {
    lastPassiveRefresh = now();
    refresh();
  };
  const onPageShow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) explicit();
  };

  window.addEventListener(STUDIO_STATS_REFRESH_EVENT, explicit);
  window.addEventListener('focus', passive);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', passive);
  const channel = openChannel();
  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'refresh' && event.data.source !== TAB_ID) explicit();
    };
  }

  return () => {
    window.removeEventListener(STUDIO_STATS_REFRESH_EVENT, explicit);
    window.removeEventListener('focus', passive);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', passive);
    channel?.close();
  };
}
