'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Zap,
  Film,
  FolderDown,
  Activity,
  Settings,
  Menu,
  X,
  LogOut,
  CreditCard,
  ShieldCheck,
} from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch('/api/stats').then((res) => res.ok && res.json()).then(setStats).catch(() => null);
    fetch('/api/auth/me').then((res) => res.json()).then((data) => setIsAdmin(data.user?.role === 'ADMIN')).catch(() => null);
    setOpen(false);
  }, [pathname]);

  const nav = [
    { name: 'Studio', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Posts', href: '/dashboard/content', icon: Film },
    { name: 'Flows', href: '/dashboard/automations', icon: Zap },
    { name: 'Resources', href: '/dashboard/resources', icon: FolderDown },
    { name: 'Plans', href: '/dashboard/pricing', icon: CreditCard },
    { name: 'Logs', href: '/dashboard/logs', icon: Activity },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings },
    ...(isAdmin ? [{ name: 'UPI reviews', href: '/dashboard/admin/payments', icon: ShieldCheck }] : []),
  ];

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-[#07040a] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 film-grain" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,63,94,0.18),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.16),transparent_24%)]" />

      <header className="relative z-20 flex items-center justify-between border-b border-white/10 px-4 py-3 md:hidden">
        <span className="font-display text-lg font-black">InstaDM</span>
        <button onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      </header>

      <div className="relative z-10 mx-auto flex max-w-[1400px]">
        <aside className={`md:flex ${open ? 'flex' : 'hidden'} w-full flex-col justify-between border-white/10 bg-black/30 p-4 backdrop-blur-xl md:sticky md:top-0 md:h-screen md:w-64 md:border-r`}>
          <div>
            <div className="mb-8 hidden items-center gap-3 md:flex">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-300 font-display text-lg font-black text-zinc-950">
                i
              </div>
              <div>
                <p className="font-display text-xl font-black leading-none">InstaDM</p>
                <p className="text-[11px] text-fuchsia-300">tap a post · send a DM</p>
              </div>
            </div>
            <nav className="space-y-1">
              {nav.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold ${active ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    <Icon className="h-4 w-4" /> {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 p-3">
              {stats?.profilePictureUrl ? (
                <img src={stats.profilePictureUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="h-10 w-10 rounded-full bg-white/10" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{stats?.instagramUsername ? `@${stats.instagramUsername}` : 'Not connected'}</p>
                <p className="text-[11px] text-zinc-500">{stats?.connectionStatus === 'CONNECTED' ? 'Live' : 'Connect from Studio'}</p>
              </div>
            </div>
            <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-500/20 py-2 text-xs font-semibold text-rose-300">
              <LogOut className="h-3.5 w-3.5" /> Log out
            </button>
          </div>
        </aside>
        <main className="min-h-screen flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
