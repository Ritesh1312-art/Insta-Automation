/**
 * UI regression tests for the Studio overview (`src/app/dashboard/page.tsx`).
 *
 * Production bug: the Flows list showed one ACTIVE flow while Studio's
 * "Active flows" card showed 0/0. The two screens disagreed because they read
 * different counters and Studio kept serving a cached response.
 *
 * These tests render the real page component against the real
 * `GET /api/stats`, `GET /api/automations` and `PATCH /api/automations`
 * handlers (in-memory Prisma), so they assert what a creator actually sees:
 * a flow that Flows lists as ACTIVE can never display as anything other than
 * 1/1 in Studio, Studio never reads from the HTTP cache, and Studio picks up
 * changes made on the Flows or admin Users screens without a manual reload.
 *
 * `GET /api/logs` only feeds the "Latest activity" list, which is unrelated to
 * the flow counter, so it is answered with a fixed empty payload instead of
 * being driven through the database.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({
  db: null as unknown as FakePrismaType,
  session: vi.fn(),
  hooks: {
    values: [] as unknown[],
    refs: [] as Array<{ current: unknown }>,
    callbacks: [] as Array<{ fn: unknown; deps?: readonly unknown[] }>,
    effects: [] as Array<{ deps?: readonly unknown[]; cleanup?: () => void }>,
    counters: { value: 0, ref: 0, callback: 0, effect: 0 },
  },
}));

vi.mock('@/lib/auth', () => ({ requireSessionUser: state.session }));
vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});
vi.mock('next/link', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

/**
 * The page is rendered by calling it directly, so React's own hook dispatcher
 * is never involved. These stand-ins keep hook state between renders and run
 * effects once per dependency change, exactly like `dashboard/layout.test.ts`.
 */
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');

  const useState = <T,>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] => {
    const index = state.hooks.counters.value++;
    if (!(index in state.hooks.values)) {
      state.hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    const setState = (next: T | ((previous: T) => T)) => {
      const previous = state.hooks.values[index] as T;
      state.hooks.values[index] = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
    };
    return [state.hooks.values[index] as T, setState];
  };

  const useRef = <T,>(initial: T) => {
    const index = state.hooks.counters.ref++;
    if (!(index in state.hooks.refs)) state.hooks.refs[index] = { current: initial };
    return state.hooks.refs[index] as { current: T };
  };

  // Memoised by dependency, so the `load` callback keeps one identity and the
  // mount effect (and its refresh subscription) runs only once.
  const useCallback = <T,>(callback: T, deps?: readonly unknown[]) => {
    const index = state.hooks.counters.callback++;
    const previous = state.hooks.callbacks[index];
    const unchanged = Boolean(
      previous && previous.deps && deps
      && previous.deps.length === deps.length
      && deps.every((dependency, position) => Object.is(dependency, previous.deps![position])),
    );
    state.hooks.callbacks[index] = unchanged ? previous : { fn: callback, deps };
    return state.hooks.callbacks[index].fn as T;
  };

  const useEffect = (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = state.hooks.counters.effect++;
    const previous = state.hooks.effects[index];
    const changed = !previous || !previous.deps || !deps
      || previous.deps.length !== deps.length
      || deps.some((dependency, position) => !Object.is(dependency, previous.deps![position]));
    if (!changed) return;
    previous?.cleanup?.();
    const cleanup = effect();
    state.hooks.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
  };

  const hooks = { useState, useEffect, useCallback, useRef };
  return { ...actual, default: { ...actual, ...hooks }, ...hooks };
});

import DashboardOverview from './page';
import { GET as getFlows, PATCH as patchFlow } from '../api/automations/route';
import { GET as getStats } from '../api/stats/route';
import { resetUserAnalytics } from '@/lib/analytics-reset';
import { requestStudioStatsRefresh } from '@/lib/studio-refresh';

class FakeWindow extends EventTarget {
  location = { search: '' };
}

class FakeDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

type FetchCall = { url: string; init?: RequestInit };

let fakeWindow: FakeWindow;
let fakeDocument: FakeDocument;
let fetchCalls: FetchCall[];

function stubFetch() {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, init });
    if (url === '/api/stats') return getStats();
    if (url === '/api/logs') return Response.json({ runs: [] });
    throw new Error(`Studio fetched an unexpected URL: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function signIn(userId: string) {
  state.session.mockResolvedValue({ userId, email: `${userId}@example.test`, role: 'USER' });
}

function seedOwner(id: string, overrides: Record<string, unknown> = {}) {
  return state.db.seed('user', { id, email: `${id}@example.test`, passwordHash: 'hash', ...overrides });
}

function seedConnection(userId: string, instagramAccountId: string, overrides: Record<string, unknown> = {}) {
  return state.db.seed('metaConnection', {
    userId, metaUserId: `meta-${instagramAccountId}`, instagramAccountId, instagramUsername: `${userId}_ig`,
    accessTokenEncrypted: `encrypted-token-${instagramAccountId}`, ...overrides,
  });
}

function seedFlow(userId: string, instagramAccountId: string, status: string, overrides: Record<string, unknown> = {}) {
  return state.db.seed('automation', {
    userId, instagramAccountId, status, name: `${userId} ${status} flow`, keywords: ['guide'],
    dmMessageTemplate: 'Here you go', ...overrides,
  });
}

function automationRequest(body: unknown) {
  return new Request('https://app.example.test/api/automations', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never;
}

/** Renders the page once with the current hook state and returns its markup. */
function renderStudio() {
  state.hooks.counters = { value: 0, ref: 0, callback: 0, effect: 0 };
  const tree = DashboardOverview();
  return { tree, markup: renderToStaticMarkup(tree) };
}

function unmountStudio() {
  for (const effect of state.hooks.effects) effect.cleanup?.();
}

/** Lets every pending `load()` promise chain settle. */
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function visitElements(node: ReactNode, visit: (element: ReactElement<Record<string, unknown>>) => void) {
  if (Array.isArray(node)) {
    node.forEach((child) => visitElements(child, visit));
    return;
  }
  if (!isValidElement(node)) return;
  const element = node as ReactElement<Record<string, unknown>>;
  visit(element);
  if (element.props?.children) visitElements(element.props.children as ReactNode, visit);
}

/** The rendered `StatCard`s, keyed by their own props rather than by styling. */
function statCards(node: ReactNode): Record<string, string> {
  const cards: Record<string, string> = {};
  visitElements(node, (element) => {
    const { label, value } = element.props as { label?: unknown; value?: unknown };
    if (typeof label === 'string' && typeof value === 'string') cards[label] = value;
  });
  return cards;
}

async function activeFlowsListed() {
  const body = await (await getFlows()).json() as { automations: Array<{ status: string }> };
  return body.automations.filter((flow) => flow.status === 'ACTIVE').length;
}

beforeEach(() => {
  state.db.reset();
  state.session.mockReset();
  state.hooks = { values: [], refs: [], callbacks: [], effects: [], counters: { value: 0, ref: 0, callback: 0, effect: 0 } };
  fetchCalls = [];
  fakeWindow = new FakeWindow();
  fakeDocument = new FakeDocument();
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  // Cross-tab notification only; stubbed off so refresh counts stay deterministic.
  vi.stubGlobal('BroadcastChannel', undefined);
  stubFetch();
});

afterEach(() => {
  unmountStudio();
  vi.unstubAllGlobals();
});

describe('Studio overview page', () => {
  it('shows one ACTIVE flow as 1/1, matching the Flows list', async () => {
    signIn('owner');
    seedOwner('owner');
    seedConnection('owner', 'ig-owner');
    seedFlow('owner', 'ig-owner', 'ACTIVE');

    const pending = renderStudio();
    expect(statCards(pending.tree)).toEqual({}); // skeleton first, no stale numbers
    expect(pending.markup).toContain('animate-pulse');

    await settle();
    const loaded = renderStudio();
    expect(statCards(loaded.tree)['Active flows']).toBe('1/1');
    expect(loaded.markup).toContain('>1/1<');
    expect(loaded.markup).not.toContain('>0/0<');
    expect(loaded.markup).not.toContain('animate-pulse');

    // The screen the creator compares it against.
    const flows = await (await getFlows()).json() as { automations: Array<{ status: string }> };
    expect(flows.automations).toHaveLength(1);
    expect(flows.automations[0].status).toBe('ACTIVE');
    expect(await activeFlowsListed()).toBe(1);
  });

  it('reports 0/0 only when the workspace really has no flows', async () => {
    signIn('owner');
    seedOwner('owner');
    seedConnection('owner', 'ig-owner');

    renderStudio();
    await settle();

    const { tree, markup } = renderStudio();
    expect(statCards(tree)['Active flows']).toBe('0/0');
    expect(markup).toContain('>0/0<');
    expect(await activeFlowsListed()).toBe(0);
  });

  it('counts exactly the flows the Flows list returns, per owner and per status', async () => {
    signIn('alice');
    seedOwner('alice');
    seedConnection('alice', 'ig-alice');
    seedFlow('alice', 'ig-alice', 'ACTIVE');
    seedFlow('alice', 'ig-alice', 'PAUSED');
    seedFlow('alice', 'ig-alice', 'DRAFT');
    // A different workspace's ACTIVE flow must not be counted or listed.
    seedOwner('bob');
    seedConnection('bob', 'ig-bob');
    seedFlow('bob', 'ig-bob', 'ACTIVE');

    renderStudio();
    await settle();

    const { tree } = renderStudio();
    expect(statCards(tree)['Active flows']).toBe('1/3');

    const flows = await (await getFlows()).json() as { automations: Array<{ userId: string; status: string }> };
    expect(flows.automations).toHaveLength(3);
    expect(flows.automations.every((flow) => flow.userId === 'alice')).toBe(true);
    expect(statCards(tree)['Active flows'])
      .toBe(`${flows.automations.filter((flow) => flow.status === 'ACTIVE').length}/${flows.automations.length}`);
  });

  it('never reads Studio statistics or activity from the HTTP cache', async () => {
    signIn('owner');
    seedOwner('owner');
    seedConnection('owner', 'ig-owner');

    renderStudio();
    await settle();

    expect(fetchCalls.map((call) => call.url)).toEqual(['/api/stats', '/api/logs']);
    for (const call of fetchCalls) {
      expect(call.init, `${call.url} must be fetched with cache: 'no-store'`).toMatchObject({ cache: 'no-store' });
    }
  });

  it('warns about an incomplete webhook setup without telling the creator to reconnect', async () => {
    signIn('owner');
    seedOwner('owner');
    // The token is fine: only Meta's subscribe call failed.
    seedConnection('owner', 'ig-owner', { connectionStatus: 'CONNECTED', webhookStatus: 'PARTIAL' });

    renderStudio();
    await settle();
    const { markup } = renderStudio();

    expect(markup).toContain('webhook subscription poora nahi hua');
    // Reconnecting would not fix a webhook gap, so the instruction must not appear.
    expect(markup).not.toContain('Instagram token invalid ya expired hai');
    expect(markup).not.toContain('Reconnect Instagram');
    expect(markup).toContain('@owner_ig'); // the connection is still shown as linked
  });

  it('still asks for a reconnect when the token really expired', async () => {
    signIn('owner');
    seedOwner('owner');
    seedConnection('owner', 'ig-owner', { connectionStatus: 'TOKEN_EXPIRED', webhookStatus: 'SUBSCRIBED' });

    renderStudio();
    await settle();
    const { markup } = renderStudio();

    expect(markup).toContain('Instagram token invalid ya expired hai');
    expect(markup).toContain('Reconnect Instagram');
    expect(markup).not.toContain('webhook subscription poora nahi hua');
  });

  it('keeps the reconnect instruction alone when the token expired and webhooks are also broken', async () => {
    signIn('owner');
    seedOwner('owner');
    seedConnection('owner', 'ig-owner', { connectionStatus: 'TOKEN_EXPIRED', webhookStatus: 'FAILED' });

    renderStudio();
    await settle();
    const { markup } = renderStudio();

    expect(markup).toContain('Instagram token invalid ya expired hai');
    expect(markup).toContain('Reconnect Instagram');
    // Reconnecting is the prerequisite; the webhook note must not compete with it.
    expect(markup).not.toContain('webhook subscription poora nahi hua');
  });

  it('describes an ERROR connection as an error instead of claiming the token expired', async () => {
    signIn('owner');
    seedOwner('owner');
    seedConnection('owner', 'ig-owner', { connectionStatus: 'ERROR', webhookStatus: 'UNKNOWN' });

    renderStudio();
    await settle();
    const { markup } = renderStudio();

    expect(markup).toContain('connection error state mein hai');
    expect(markup).not.toContain('Instagram token invalid ya expired hai');
  });

  it('shows the webhook warning the OAuth callback passed in the redirect', async () => {
    signIn('owner');
    seedOwner('owner');
    seedConnection('owner', 'ig-owner', { connectionStatus: 'CONNECTED', webhookStatus: 'UNKNOWN' });
    fakeWindow.location.search = '?connected=true&webhookWarning=true';

    renderStudio();
    await settle();
    const { markup } = renderStudio();

    expect(markup).toContain('webhook subscription poora nahi hua');
    expect(markup).not.toContain('Reconnect Instagram');
  });

  it('offers admins a direct link to the webhook settings when the setup is incomplete', async () => {
    signIn('admin');
    seedOwner('admin', { role: 'ADMIN' });
    seedConnection('admin', 'ig-admin', { connectionStatus: 'CONNECTED', webhookStatus: 'FAILED' });

    renderStudio();
    await settle();
    const { tree } = renderStudio();

    const links: string[] = [];
    visitElements(tree, (element) => {
      const href = (element.props as { href?: unknown }).href;
      if (typeof href === 'string') links.push(href);
    });
    expect(links).toContain('/dashboard/settings');
  });

  it('refetches when the tab becomes visible again and stays put while hidden', async () => {
    signIn('owner');
    seedOwner('owner');
    seedConnection('owner', 'ig-owner');
    seedFlow('owner', 'ig-owner', 'ACTIVE');

    renderStudio();
    await settle();
    const afterMount = fetchCalls.length;

    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchCalls).toHaveLength(afterMount);

    fakeDocument.visibilityState = 'visible';
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchCalls).toHaveLength(afterMount + 2);
    expect(statCards(renderStudio().tree)['Active flows']).toBe('1/1');
  });

  it('moves to 2/2 after the Flows screen activates a flow and asks Studio to refresh', async () => {
    signIn('owner');
    seedOwner('owner', { plan: 'PREMIUM', monthlyDmQuota: 750 });
    seedConnection('owner', 'ig-owner');
    seedFlow('owner', 'ig-owner', 'ACTIVE');
    const paused = seedFlow('owner', 'ig-owner', 'PAUSED');

    renderStudio();
    await settle();
    expect(statCards(renderStudio().tree)['Active flows']).toBe('1/2');

    // What the Flows page does when a creator activates a flow.
    expect((await patchFlow(automationRequest({ id: paused.id, status: 'ACTIVE' }))).status).toBe(200);
    requestStudioStatsRefresh();
    await settle();

    const refreshed = renderStudio();
    expect(statCards(refreshed.tree)['Active flows']).toBe('2/2');
    expect(refreshed.markup).toContain('>2/2<');
    expect(await activeFlowsListed()).toBe(2);
  });

  it('keeps the flow ACTIVE on screen and clears the comment counter after an admin analytics reset', async () => {
    signIn('owner');
    seedOwner('owner', { totalCommentsReceived: 84, plan: 'PREMIUM', monthlyDmQuota: 750, dmsUsedThisMonth: 12 });
    seedOwner('admin', { role: 'ADMIN' });
    seedConnection('owner', 'ig-owner');
    seedFlow('owner', 'ig-owner', 'ACTIVE', { totalTriggers: 20, totalSuccess: 17, totalFailed: 3, lastTriggeredAt: new Date() });

    renderStudio();
    await settle();
    const before = renderStudio();
    expect(statCards(before.tree)).toMatchObject({ 'Active flows': '1/1', 'Comments received': '84' });
    expect(before.markup).toContain('of 750 used');

    const result = await resetUserAnalytics({ adminId: 'admin', targetUserId: 'owner' });
    expect(result?.previous.totalCommentsReceived).toBe(84);

    // What the admin Users page does after a successful reset.
    requestStudioStatsRefresh();
    await settle();

    const after = renderStudio();
    expect(statCards(after.tree)).toMatchObject({ 'Active flows': '1/1', 'Comments received': '0' });
    expect(after.markup).not.toContain('animate-pulse'); // background refresh, numbers stay visible
    expect(after.markup).toContain('of 750 used'); // DM quota untouched

    const owner = state.db.rows('user').find((row) => row.id === 'owner');
    expect(owner).toMatchObject({ totalCommentsReceived: 0, dmsUsedThisMonth: 12, plan: 'PREMIUM' });
    expect(state.db.rows('automation')).toEqual([
      expect.objectContaining({ status: 'ACTIVE', totalTriggers: 0, totalSuccess: 0, totalFailed: 0, lastTriggeredAt: null }),
    ]);
  });
});
