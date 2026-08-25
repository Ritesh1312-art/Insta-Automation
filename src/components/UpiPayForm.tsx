'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { Plan } from '@/lib/plans';
import { buildUpiUri } from '@/lib/upi';

export default function UpiPayForm({
  plan,
  upiId,
  payeeName,
  qrCodeUrl,
  onDone,
}: {
  plan: Plan;
  upiId: string;
  payeeName: string;
  qrCodeUrl?: string;
  onDone?: () => void;
}) {
  const [payerName, setPayerName] = useState('');
  const [payerUpiId, setPayerUpiId] = useState('');
  const [utrNumber, setUtrNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const upiUri = useMemo(
    () => (upiId ? buildUpiUri({ upiId, payeeName, amount: plan.priceInr, note: `InstaDM ${plan.name}` }) : ''),
    [upiId, payeeName, plan]
  );
  const qrSrc = qrCodeUrl || (upiUri ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiUri)}` : '');

  const copyUpi = async () => {
    if (!upiId) return;
    await navigator.clipboard.writeText(upiId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/payments/direct-upi/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planType: plan.id,
          payerName,
          payerUpiId,
          utrNumber,
          amount: plan.priceInr,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not submit payment');
        return;
      }
      setMessage(data.message);
      onDone?.();
    } catch {
      setError('Network error while submitting payment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-fuchsia-500/30 bg-slate-950 p-4 text-sm text-slate-300">
        <p className="text-xs uppercase tracking-wide text-fuchsia-300">Pay exactly ₹{plan.priceInr}</p>
        <p className="mt-1 text-lg font-bold text-white">{plan.name} · {plan.quotaLabel}</p>
        <p className="mt-2 text-xs text-slate-400">
          Pay from PhonePe, GPay, or Paytm. Then submit the receipt UTR. The plan stays pending until an admin matches the credit in the bank/UPI app.
        </p>
      </div>

      {upiId ? (
        <>
          {qrSrc && (
            <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-2xl bg-white p-3">
              <img src={qrSrc} alt="UPI QR" className="h-full w-full object-contain" />
            </div>
          )}
          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
            <div>
              <p className="text-[11px] uppercase text-slate-500">Pay to</p>
              <p className="font-semibold text-white">{payeeName}</p>
              <p className="font-mono text-sm text-fuchsia-300">{upiId}</p>
            </div>
            <button type="button" onClick={copyUpi} className="rounded-lg bg-fuchsia-600 px-3 py-2 text-xs font-bold text-white">
              {copied ? 'Copied' : 'Copy UPI'}
            </button>
          </div>
        </>
      ) : (
        <p className="rounded-xl border border-amber-700/50 bg-amber-950/40 p-3 text-sm text-amber-200">
          Admin UPI ID is not configured yet. Set UPI_ID in environment variables or save it in Settings.
        </p>
      )}

      <form onSubmit={submit} className="space-y-3">
        <input
          required
          value={payerName}
          onChange={(e) => setPayerName(e.target.value)}
          placeholder="Name on UPI payment"
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white"
        />
        <input
          required
          value={payerUpiId}
          onChange={(e) => setPayerUpiId(e.target.value)}
          placeholder="Your UPI ID (name@okaxis)"
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white"
        />
        <input
          required
          value={utrNumber}
          onChange={(e) => setUtrNumber(e.target.value.replace(/\s/g, ''))}
          placeholder="UTR / UPI Ref No."
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 font-mono text-sm tracking-wide text-white"
        />
        <button
          disabled={busy}
          className="w-full rounded-xl bg-fuchsia-600 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Submitting…' : 'Submit for verification'}
        </button>
      </form>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {message && <p className="text-sm text-emerald-400">{message}</p>}
    </div>
  );
}
