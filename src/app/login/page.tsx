'use client';
import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!response.ok) {
      setError((await response.json()).error || 'Unable to sign in');
      return;
    }
    router.replace(next.startsWith('/') ? next : '/dashboard');
    router.refresh();
  };
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07040a] p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(244,63,94,0.25),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.2),transparent_28%)]" />
      <form onSubmit={submit} className="relative w-full max-w-sm space-y-4 rounded-[2rem] border border-white/10 bg-black/40 p-7 backdrop-blur-xl">
        <p className="font-display text-3xl font-black text-white">Walk back in.</p>
        <p className="text-sm text-zinc-400">Your Reels are waiting on the studio wall.</p>
        <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-white" />
        <input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="w-full rounded-2xl border border-white/10 bg-black/50 p-3 text-white" />
        <button className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 via-rose-500 to-amber-400 p-3 font-black text-zinc-950">Sign in</button>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-between text-xs text-zinc-500">
          <Link href="/forgot" className="hover:text-white">Forgot?</Link>
          <Link href="/register" className="hover:text-white">Create account</Link>
        </div>
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
