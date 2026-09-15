'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PLANS, type Plan, type PlanId, normalizePlanId } from '@/lib/plans';
import UpiPayForm from '@/components/UpiPayForm';

function VerifyInner() {
  const params = useSearchParams();
  const requested = normalizePlanId(params.get('plan')) || 'PREMIUM';
  const [planId, setPlanId] = useState<PlanId>(requested === 'FREE' ? 'PREMIUM' : requested);
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('InstaDM Auto');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then((res) => setAuthed(res.ok)).catch(() => setAuthed(false));
    fetch('/api/billing/public')
      .then((res) => res.json())
      .then((data) => {
        if (data.upiId) setUpiId(data.upiId);
        if (data.payeeName) setPayeeName(data.payeeName);
        if (data.qrCodeUrl) setQrCodeUrl(data.qrCodeUrl);
      })
      .catch(() => null);
  }, []);

  const plan: Plan = PLANS[planId];

  return (
    <main className="min-h-screen bg-[#07070A] px-4 py-10 text-slate-100">
      <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[1fr_1.1fr]">
        <section className="space-y-4">
          <Link href="/" className="text-xs text-slate-500 hover:text-white">← Back to plans</Link>
          <h1 className="text-3xl font-black text-white">Verify your UPI payment</h1>
          <p className="text-sm text-slate-400">
            Pay the exact plan amount, then submit name, your UPI ID, and the receipt UTR. We never auto-activate a plan from a typed reference number.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.values(PLANS) as Plan[]).filter((item) => item.id !== 'FREE').map((item) => (
              <button
                key={item.id}
                onClick={() => setPlanId(item.id)}
                className={`rounded-xl border px-3 py-2 text-left text-xs ${planId === item.id ? 'border-fuchsia-500 bg-fuchsia-950/40 text-white' : 'border-slate-800 bg-slate-950 text-slate-400'}`}
              >
                <div className="font-bold">{item.name}</div>
                <div>₹{item.priceInr} · {item.quotaLabel}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-950 p-6">
          {authed === false ? (
            <div className="space-y-4 text-sm">
              <p className="text-slate-300">Sign in or create an account before submitting a payment. This ties the UTR to your workspace.</p>
              <div className="flex gap-3">
                <Link href={`/login?next=/verify?plan=${plan.id}`} className="rounded-xl bg-fuchsia-600 px-4 py-2 font-bold text-white">Sign in</Link>
                <Link href={`/register?next=/verify?plan=${plan.id}`} className="rounded-xl border border-slate-700 px-4 py-2 font-semibold">Create account</Link>
              </div>
            </div>
          ) : (
            <UpiPayForm plan={plan} upiId={upiId} payeeName={payeeName} qrCodeUrl={qrCodeUrl} />
          )}
        </section>
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#07070A] p-10 text-slate-400">Loading payment form…</main>}>
      <VerifyInner />
    </Suspense>
  );
}
