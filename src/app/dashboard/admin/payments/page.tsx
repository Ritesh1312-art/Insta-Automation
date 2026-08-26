'use client';

import { useEffect, useState } from 'react';
import { CreditCard, CheckCircle2, XCircle } from 'lucide-react';

type Payment = {
  id: string;
  userEmail: string;
  payerName: string;
  payerUpiId: string;
  planType: string;
  amount: number;
  utrNumber: string;
  status: string;
  createdAt: string;
  reviewNote?: string | null;
};

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    const res = await fetch('/api/payments/direct-upi/review');
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Unable to load payments');
      return;
    }
    setPayments(data.payments || []);
  };

  useEffect(() => {
    load().catch(() => setError('Unable to load payments'));
  }, []);

  const review = async (paymentId: string, decision: 'VERIFIED' | 'REJECTED') => {
    const reviewNote = window.prompt(decision === 'VERIFIED' ? 'Optional note (UTR matched in UPI app)' : 'Reason for rejection') || '';
    setBusyId(paymentId);
    const res = await fetch('/api/payments/direct-upi/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, decision, reviewNote }),
    });
    const data = await res.json();
    setBusyId('');
    if (!res.ok) {
      alert(data.error || 'Review failed');
      return;
    }
    await load();
  };

  const revenue = payments.filter((item) => item.status === 'VERIFIED').reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <CreditCard className="h-6 w-6 text-purple-400" /> UPI verification queue
          </h1>
          <p className="text-sm text-slate-400">Approve only after the UTR and amount appear in your bank/UPI app.</p>
        </div>
        <div className="rounded-2xl border border-purple-800/60 bg-purple-950/60 px-5 py-3 text-right">
          <span className="text-xs font-semibold uppercase text-slate-400">Verified revenue</span>
          <p className="text-2xl font-extrabold text-purple-300">₹{revenue.toLocaleString('en-IN')}</p>
        </div>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        {payments.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">No UPI submissions yet.</div>
        ) : (
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="border-b border-slate-800 bg-slate-900 font-mono text-[11px] uppercase text-slate-400">
              <tr>
                <th className="p-4">Customer</th>
                <th className="p-4">Plan</th>
                <th className="p-4">Amount</th>
                <th className="p-4">UTR</th>
                <th className="p-4">Status</th>
                <th className="p-4">Submitted</th>
                <th className="p-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {payments.map((pay) => (
                <tr key={pay.id} className="hover:bg-slate-900/40">
                  <td className="p-4">
                    <div className="font-semibold text-white">{pay.userEmail}</div>
                    <div className="text-slate-500">{pay.payerName} · {pay.payerUpiId}</div>
                  </td>
                  <td className="p-4 text-purple-300">{pay.planType}</td>
                  <td className="p-4 font-bold text-emerald-400">₹{pay.amount}</td>
                  <td className="p-4 font-extrabold tracking-wider text-purple-300">{pay.utrNumber}</td>
                  <td className="p-4">{pay.status}</td>
                  <td className="p-4 text-slate-400">{new Date(pay.createdAt).toLocaleString('en-IN')}</td>
                  <td className="p-4">
                    {pay.status === 'PENDING_REVIEW' ? (
                      <div className="flex gap-2">
                        <button
                          disabled={busyId === pay.id}
                          onClick={() => review(pay.id, 'VERIFIED')}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Approve
                        </button>
                        <button
                          disabled={busyId === pay.id}
                          onClick={() => review(pay.id, 'REJECTED')}
                          className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-bold text-white"
                        >
                          <XCircle className="h-3 w-3" /> Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-500">{pay.reviewNote || '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
