'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function ForgotPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  const [step, setStep] = useState(1); // 1 = request email, 2 = verify and reset
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRequestOtp = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    
    try {
      const response = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REQUEST_OTP', email })
      });
      const data = await response.json();
      
      if (!response.ok) {
        setMessage(data.error || 'Failed to request OTP');
        return;
      }
      
      setIsSuccess(true);
      setMessage(data.message);
      if (data.debugOtp) {
        setOtp(data.debugOtp);
      }
      setStep(2);
    } catch (err: any) {
      setMessage(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndReset = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    
    try {
      const response = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'VERIFY_AND_RESET', email, otp, newPassword })
      });
      const data = await response.json();
      
      if (!response.ok) {
        setIsSuccess(false);
        setMessage(data.error || 'Failed to verify OTP');
        return;
      }
      
      setIsSuccess(true);
      setMessage('Password updated successfully! Redirecting to login...');
      setTimeout(() => {
        router.replace('/login');
      }, 2000);
    } catch (err: any) {
      setMessage(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-bold text-white">Reset Account Password</h1>
        
        {step === 1 ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <p className="text-xs text-slate-400">
              Enter your registered email address below. We will generate a secure OTP code to verify your identity.
            </p>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Registered email"
              className="w-full text-xs rounded-lg bg-slate-950 border border-slate-700 p-3 text-white focus:outline-none focus:border-fuchsia-500"
            />
            <button
              disabled={loading}
              className="w-full rounded-lg bg-fuchsia-600 p-3 font-semibold text-white text-xs hover:bg-fuchsia-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Generating Code...' : 'Get OTP Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyAndReset} className="space-y-4">
            <p className="text-xs text-slate-400">
              Enter the 6-digit verification code and choose your new secure password.
            </p>
            
            <input
              required
              type="text"
              pattern="[0-9]{6}"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="6-Digit OTP Code"
              className="w-full text-xs font-mono text-center tracking-widest rounded-lg bg-slate-950 border border-slate-700 p-3 text-white focus:outline-none focus:border-fuchsia-500"
            />

            <input
              required
              minLength={12}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New Password (12+ characters)"
              className="w-full text-xs rounded-lg bg-slate-950 border border-slate-700 p-3 text-white focus:outline-none focus:border-fuchsia-500"
            />

            <button
              disabled={loading}
              className="w-full rounded-lg bg-fuchsia-600 p-3 font-semibold text-white text-xs hover:bg-fuchsia-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Resetting Password...' : 'Verify OTP & Reset'}
            </button>
          </form>
        )}

        {message && (
          <div className={`p-3 rounded-lg border text-xs leading-relaxed ${isSuccess ? 'bg-emerald-950/20 border-emerald-800 text-emerald-400' : 'bg-rose-950/20 border-rose-800 text-rose-400'}`}>
            {message}
          </div>
        )}

        <div className="text-center pt-2">
          <Link href="/login" className="text-xs text-slate-400 hover:text-white underline">
            Back to Login
          </Link>
        </div>
      </div>
    </main>
  );
}
