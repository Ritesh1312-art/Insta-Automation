'use client';

import { useEffect, useState } from 'react';
import { PLANS, type Plan } from '@/lib/plans';
import UpiPayForm from '@/components/UpiPayForm';

export default function PricingPage() {
  const [userStatus, setUserStatus] = useState({ plan: 'FREE', dmsUsed: 0, quota: 30, status: 'INACTIVE', role: 'USER' });
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('InstaDM Auto');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  const refresh = () => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUserStatus({
            plan: data.user.plan || 'FREE',
            dmsUsed: data.user.dmsUsedThisMonth || 0,
            quota: data.user.monthlyDmQuota || 30,
            status: data.user.subscriptionStatus || 'INACTIVE',
            role: data.user.role || 'USER',
          });
        }
      })
      .catch(() => null);

    fetch('/api/admin/upi-settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.adminUpiId) setUpiId(data.adminUpiId);
        if (data.payeeName) setPayeeName(data.payeeName);
        if (data.adminQrCodeUrl) setQrCodeUrl(data.adminQrCodeUrl);
      })
      .catch(() => null);
  };

  useEffect(() => {
    refresh();
  }, []);

  const plans = Object.values(PLANS) as Plan[];

  return (
    <div className="mx-auto max-w-6xl px-2 py-4">
      <div className="mb-10 text-center">
        <span className="rounded-full bg-purple-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-purple-400">
          Direct UPI · manual verification
        </span>
        <h1 className="mt-3 text-4xl font-extrabold text-white">Choose a monthly DM quota</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">
          Plans are hard caps, not “unlimited”. After you pay, an admin matches the UTR in the UPI app before the quota is applied.
        </p>
        <div className="mt-6 inline-flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-5 py-3">
          <div className="text-left">
            <p className="text-xs text-slate-400">Current plan · {userStatus.status}</p>
            <p className="text-sm font-bold text-purple-400">
              {userStatus.plan} ({userStatus.dmsUsed} / {userStatus.quota} DMs)
            </p>
          </div>
          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-purple-500" style={{ width: `${Math.min(100, (userStatus.dmsUsed / Math.max(userStatus.quota, 1)) * 100)}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-5">
        {plans.map((plan) => {
          const current = userStatus.plan === plan.id;
          return (
            <div
              key={plan.id}
              className={`flex flex-col justify-between rounded-2xl border p-5 ${plan.highlighted ? 'border-purple-500 bg-purple-950/20' : 'border-slate-800 bg-slate-900/60'}`}
            >
              <div>
                <span className="text-sm font-bold text-purple-300">{plan.name}</span>
                <div className="mt-3 flex items-baseline">
                  <span className="text-3xl font-black text-white">₹{plan.priceInr}</span>
                  <span className="ml-1 text-sm text-slate-400">/ 30 days</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">{plan.tagline}</p>
                <ul className="mt-5 space-y-2 text-sm text-slate-300">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <span className="text-purple-400">✓</span> {feature}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                disabled={current || plan.id === 'FREE'}
                onClick={() => setSelectedPlan(plan)}
                className="mt-6 w-full rounded-xl bg-purple-600 py-3 text-sm font-bold text-white disabled:cursor-default disabled:bg-slate-800 disabled:text-slate-400"
              >
                {current ? 'Current plan' : plan.id === 'FREE' ? 'Included' : plan.cta}
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-center text-xs text-slate-500">
        Instagram can still rate-limit or restrict the connected professional account. Quotas exist to keep sending inside a safer envelope.
      </p>

      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-purple-500/40 bg-slate-950 p-6">
            <button onClick={() => setSelectedPlan(null)} className="absolute right-4 top-4 text-slate-400">✕</button>
            <UpiPayForm
              plan={selectedPlan}
              upiId={upiId}
              payeeName={payeeName}
              qrCodeUrl={qrCodeUrl}
              onDone={() => {
                refresh();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
