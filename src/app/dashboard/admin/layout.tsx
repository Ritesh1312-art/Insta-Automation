import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireSessionUser } from '@/lib/auth';

export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireSessionUser().catch(() => null);
  if (!session) redirect('/login');
  if (session.role !== 'ADMIN') redirect('/dashboard');
  return children;
}
