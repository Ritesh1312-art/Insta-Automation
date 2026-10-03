import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: string }) => children,
}));

import AdminLoginPage from './page';

describe('dedicated administrator login page', () => {
  it('renders only a password field and Sign in button in its form', () => {
    const markup = renderToStaticMarkup(createElement(AdminLoginPage));
    const form = markup.match(/<form[\s\S]*?<\/form>/)?.[0] ?? '';

    expect(form).toContain('Password');
    expect(form).toContain('Sign in');
    expect((form.match(/<input\b/g) ?? [])).toHaveLength(1);
    expect((form.match(/<button\b/g) ?? [])).toHaveLength(1);
    expect(form).toMatch(/<input\b[^>]*type="password"[^>]*name="password"/);
    expect(form).not.toMatch(/email|username|remember me/i);
    expect(markup).not.toContain('admin@example.test');
  });
});
