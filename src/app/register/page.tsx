'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/dashboard';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Unable to create account');
      return;
    }
    router.replace(next.startsWith('/') ? next : '/dashboard');
    router.refresh();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-bold text-white">Create your workspace</h1>
        <p className="text-sm text-slate-400">Starts on the Free plan: 30 official DMs / month.</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white" />
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white" />
        <input required minLength={12} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (12+ characters)" className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white" />
        <button className="w-full rounded-lg bg-fuchsia-600 p-3 font-medium text-white">Create account</button>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <p className="text-xs text-slate-400">Already have an account? <Link href="/login" className="underline hover:text-white">Sign in</Link></p>
      </form>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
