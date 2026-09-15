'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import PasswordInput from '@/components/PasswordInput';

export default function SetupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, token }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || 'Setup failed');
      return;
    }
    router.replace('/login');
  };

  const inputClass = 'w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-white';
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-bold text-white">Secure first-time setup</h1>
        <p className="text-sm text-slate-400">This works only when no administrator exists and requires the private setup token.</p>
        <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Admin email" className={inputClass} />
        <PasswordInput required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Secure password" className={inputClass} />
        <input required type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="SETUP_TOKEN" className={inputClass} />
        <button className="w-full rounded-lg bg-fuchsia-600 p-3 font-medium text-white">Create admin</button>
        {message && <p className="text-sm text-rose-400">{message}</p>}
      </form>
    </main>
  );
}
