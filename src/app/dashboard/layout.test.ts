import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  effectCursor: 0,
  effects: [] as Array<{ fn: () => void; deps?: readonly unknown[]; prevDeps?: readonly unknown[] }>,
  pathname: '/dashboard',
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useState = <T,>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void] => {
    const index = hookState.cursor++;
    if (!(index in hookState.states)) {
      hookState.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    const setState = (next: T | ((prev: T) => T)) => {
      const prev = hookState.states[index] as T;
      hookState.states[index] = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
    };
    return [hookState.states[index] as T, setState];
  };
  const useEffect = (fn: () => void, deps?: readonly unknown[]) => {
    const index = hookState.effectCursor++;
    const prev = hookState.effects[index];
    const changed =
      !prev ||
      !deps ||
      !prev.prevDeps ||
      deps.length !== prev.prevDeps.length ||
      deps.some((dep, i) => !Object.is(dep, prev.prevDeps![i]));
    hookState.effects[index] = { fn, deps, prevDeps: deps };
    if (changed) fn();
  };
  return {
    ...actual,
    default: {
      ...actual,
      useState,
      useEffect,
    },
    useState,
    useEffect,
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => hookState.pathname,
}));
vi.mock('next/link', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

import DashboardLayout from './layout';

function renderSidebar() {
  hookState.cursor = 0;
  hookState.effectCursor = 0;
  const tree = DashboardLayout({ children: createElement('div', null, 'content') });
  const markup = renderToStaticMarkup(tree);
  return { tree, markup };
}

function findElements(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): Array<ReactElement<Record<string, unknown>>> {
  const matches: Array<ReactElement<Record<string, unknown>>> = [];
  const visit = (current: ReactNode) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isValidElement(current)) return;
    const element = current as ReactElement<Record<string, unknown>>;
    if (predicate(element)) matches.push(element);
    if (element.props?.children) visit(element.props.children as ReactNode);
  };
  visit(node);
  return matches;
}

beforeEach(() => {
  hookState.states = [];
  hookState.cursor = 0;
  hookState.effectCursor = 0;
  hookState.effects = [];
  hookState.pathname = '/dashboard';
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => undefined)),
  );
});

describe('DashboardLayout sidebar Instagram profile picture', () => {
  it('uses /api/meta/profile-picture for a connected account and falls back to the username initial on error', () => {
    renderSidebar();

    hookState.states[1] = {
      connectionStatus: 'CONNECTED',
      instagramUsername: 'ritesh_creator',
      profilePictureUrl: 'https://scontent.cdninstagram.com/v/t51.2885-19/expired.jpg?oe=123',
    };

    const connectedRender = renderSidebar();
    expect(connectedRender.markup).toContain('src="/api/meta/profile-picture"');
    expect(connectedRender.markup).toContain('alt="@ritesh_creator profile picture"');
    expect(connectedRender.markup).not.toContain('scontent.cdninstagram.com');
    expect(connectedRender.markup).toContain('@ritesh_creator');
    expect(connectedRender.markup).toContain('Live');

    const images = findElements(connectedRender.tree, (el) => el.type === 'img');
    expect(images).toHaveLength(1);
    const onError = images[0].props.onError as (() => void) | undefined;
    expect(typeof onError).toBe('function');

    onError!();
    const fallbackRender = renderSidebar();
    expect(findElements(fallbackRender.tree, (el) => el.type === 'img')).toHaveLength(0);
    expect(fallbackRender.markup).not.toContain('<img');
    expect(fallbackRender.markup).toContain('aria-label="@ritesh_creator profile picture"');
    expect(fallbackRender.markup).toContain('rounded-full');
    expect(fallbackRender.markup).toContain('>R<');
  });

  it('resets the fallback state when the connected Instagram username or account changes', () => {
    renderSidebar();
    hookState.states[1] = {
      connectionStatus: 'CONNECTED',
      instagramUsername: 'first_account',
    };

    const firstRender = renderSidebar();
    const firstImg = findElements(firstRender.tree, (el) => el.type === 'img')[0];
    (firstImg.props.onError as () => void)();

    const failedRender = renderSidebar();
    expect(findElements(failedRender.tree, (el) => el.type === 'img')).toHaveLength(0);
    expect(failedRender.markup).toContain('>F<');

    hookState.states[1] = {
      connectionStatus: 'CONNECTED',
      instagramUsername: 'second_account',
    };

    const resetRender = renderSidebar();
    const resetImages = findElements(resetRender.tree, (el) => el.type === 'img');
    expect(resetImages).toHaveLength(1);
    expect(resetImages[0].props.src).toBe('/api/meta/profile-picture');
    expect(resetImages[0].props.alt).toBe('@second_account profile picture');
  });
});
