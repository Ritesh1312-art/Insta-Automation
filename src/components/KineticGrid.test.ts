import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KineticGrid from './KineticGrid';

/**
 * KineticGrid is a client component: Next.js still server-renders it for the
 * initial HTML. The old hard-coded `useIsStaticRenderer = () => false` branch
 * was unreachable (effects never run during SSR), so the static path was
 * removed. These tests guard the two properties that matter after the
 * refactor: rendering never touches DOM globals, and the server-rendered
 * markup is deterministic (no render-time environment checks that could cause
 * an SSR/hydration mismatch).
 */
describe('KineticGrid server rendering', () => {
  it('renders the host element and canvas without any DOM access', () => {
    const html = renderToStaticMarkup(createElement(KineticGrid, { className: 'h-64 w-full' }));
    expect(html).toContain('<canvas');
    expect(html).toContain('h-64 w-full');
    expect(html).toContain('position:relative');
  });

  it('produces deterministic markup across renders (no SSR/hydration mismatch)', () => {
    const props = { background: '#09090B', spacing: 25, radius: 300, strength: 10, trail: true };
    const first = renderToStaticMarkup(createElement(KineticGrid, props));
    const second = renderToStaticMarkup(createElement(KineticGrid, props));
    expect(first).toBe(second);
  });

  it('applies custom colors to the host style', () => {
    const html = renderToStaticMarkup(createElement(KineticGrid, { background: '#123456' }));
    expect(html).toContain('#123456');
  });
});
