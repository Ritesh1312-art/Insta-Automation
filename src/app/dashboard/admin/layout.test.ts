import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    mocks.redirect(path);
    throw new Error(`REDIRECT:${path}`);
  },
}));

import AdminDashboardLayout from './layout';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('admin dashboard page authorization', () => {
  it('redirects an authenticated regular USER away from every admin page', async () => {
    mocks.requireSessionUser.mockResolvedValue({ userId: 'regular-user', role: 'USER' });

    await expect(AdminDashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/dashboard');
    expect(mocks.redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('sends an invalid or expired session back to user login', async () => {
    mocks.requireSessionUser.mockRejectedValue(new Error('UNAUTHORIZED'));

    await expect(AdminDashboardLayout({ children: null })).rejects.toThrow('REDIRECT:/login');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });
});
