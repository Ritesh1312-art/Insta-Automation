'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Unable to sign in');
        return;
      }
      router.replace('/dashboard/admin');
      router.refresh();
    } catch {
      setError('Unable to sign in right now');
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07040a] p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(244,63,94,0.25),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.2),transparent_28%)]" />
      <section className="relative w-full max-w-sm space-y-4 rounded-[2rem] border border-white/10 bg-black/40 p-7 backdrop-blur-xl">
        <div>
          <h1 className="font-display text-3xl font-black text-white">Administrator sign in</h1>
          <p className="mt-2 text-sm text-zinc-400">Enter your administrator password to continue.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="admin-password" className="text-sm font-medium text-zinc-200">Password</label>
            <input
              id="admin-password"
              name="password"
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-white"
            />
          </div>
          <button type="submit" className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-rose-500 to-amber-400 p-3 font-black text-zinc-950">Sign in</button>
        </form>
        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
        <p className="text-xs text-zinc-500"><Link href="/login" className="hover:text-white">Back to user sign in</Link></p>
      </section>
    </main>
  );
}
