'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ResetPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    
    try {
      const response = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, token })
      });
      const data = await response.json();
      
      if (!response.ok) {
        setMessage(data.error || 'Reset failed');
        return;
      }
      
      setIsSuccess(true);
      setMessage('Password updated successfully! Redirecting to login...');
      setTimeout(() => {
        router.replace('/login');
      }, 2000);
    } catch (err: any) {
      setMessage(err.message || 'An error occurred');
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-bold text-white">Reset Account Password</h1>
        <p className="text-sm text-slate-400">Provide your registered email, a new password, and the SETUP_TOKEN.</p>
        
        <input
          required
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Registered email"
          className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-white"
        />
        
        <input
          required
          minLength={12}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="New Password (12+ characters)"
          className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-white"
        />
        
        <input
          required
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="SETUP_TOKEN"
          className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-white"
        />
        
        <button className="w-full rounded-lg bg-fuchsia-600 p-3 font-medium text-white">
          Reset Password
        </button>
        
        {message && (
          <p className={`text-sm ${isSuccess ? 'text-emerald-400' : 'text-rose-400'}`}>
            {message}
          </p>
        )}
      </form>
    </main>
  );
}
