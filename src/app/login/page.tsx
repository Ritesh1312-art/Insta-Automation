'use client';
import { FormEvent, Suspense, useState } from 'react';
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
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-bold text-white">InstaDM Auto</h1>
        <p className="text-sm text-slate-400">Sign in to manage your connected Instagram account.</p>
        <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white" />
        <input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white" />
        <button className="w-full rounded-lg bg-fuchsia-600 p-3 font-medium text-white">Sign in</button>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex items-center justify-between px-1 pt-1 text-xs text-slate-400">
          <a href="/forgot" className="underline hover:text-white">Forgot Password?</a>
          <a href="/register" className="underline hover:text-white">Create account</a>
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
