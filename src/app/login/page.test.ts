import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ children }: { children: string }) => children,
}));

import LoginPage from './page';

describe('regular user login page', () => {
  it('renders Username/Email, Password, Remember Me, and Sign in in the required order', () => {
    const markup = renderToStaticMarkup(createElement(LoginPage));

    expect(markup).toContain('Username/Email');
    expect(markup).toContain('Password');
    expect(markup).toContain('Remember Me');
    expect(markup).toContain('Sign in');
    expect(markup).toMatch(/<input\b[^>]*type="text"[^>]*name="identifier"/);

    const identifierPosition = markup.indexOf('name="identifier"');
    const passwordPosition = markup.indexOf('name="password"');
    const rememberPosition = markup.indexOf('name="rememberMe"');
    const submitPosition = markup.indexOf('Sign in');
    expect(identifierPosition).toBeLessThan(passwordPosition);
    expect(passwordPosition).toBeLessThan(rememberPosition);
    expect(rememberPosition).toBeLessThan(submitPosition);
  });
});
