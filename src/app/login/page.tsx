'use client';
import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, rememberMe }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Unable to sign in');
        return;
      }
      router.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
      router.refresh();
    } catch {
      setError('Unable to sign in right now');
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07040a] p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(244,63,94,0.25),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.2),transparent_28%)]" />
      <form onSubmit={submit} className="relative w-full max-w-sm space-y-4 rounded-[2rem] border border-white/10 bg-black/40 p-7 backdrop-blur-xl">
        <p className="font-display text-3xl font-black text-white">Walk back in.</p>
        <p className="text-sm text-zinc-400">Your Reels are waiting on the studio wall.</p>

        <div className="space-y-1.5">
          <label htmlFor="login-identifier" className="text-sm font-medium text-zinc-200">Username/Email</label>
          <input
            id="login-identifier"
            name="identifier"
            required
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Username or email"
            className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-white"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="login-password" className="text-sm font-medium text-zinc-200">Password</label>
          <input
            id="login-password"
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

        <label htmlFor="remember-me" className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            id="remember-me"
            name="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className="h-4 w-4 accent-fuchsia-500"
          />
          Remember Me
        </label>

        <button type="submit" className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-rose-500 to-amber-400 p-3 font-black text-zinc-950">Sign in</button>
        {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-between text-xs text-zinc-500">
          <Link href="/forgot" className="hover:text-white">Forgot?</Link>
          <Link href="/register" className="hover:text-white">Create account</Link>
        </div>
        <p className="text-center text-xs text-zinc-500"><Link href="/admin/login" className="hover:text-white">Administrator sign in</Link></p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
