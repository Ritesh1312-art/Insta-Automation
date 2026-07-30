'use client';

import { useState, useEffect } from 'react';
import Script from 'next/script';

export default function PricingPage() {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState({ plan: 'FREE', dmsUsed: 0, quota: 30 });

  useEffect(() => {
    // Fetch user status
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUserStatus({
            plan: data.user.plan || 'FREE',
            dmsUsed: data.user.dmsUsedThisMonth || 0,
            quota: data.user.monthlyDmQuota || 30,
          });
        }
      })
      .catch(() => null);
  }, []);

  const handleSubscribeUPI = async (planType: 'PRO_CREATOR' | 'VIP_UNLIMITED') => {
    try {
      setLoadingPlan(planType);
      const res = await fetch('/api/payments/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ritesh.gupta131290@gmail.com', planType }),
      });
      const data = await res.json();

      if (!res.ok || !data.subscriptionId) {
        alert(data.error || 'Failed to initialize UPI subscription');
        setLoadingPlan(null);
        return;
      }

      const options = {
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: 'InstaPulse ⚡',
        description: `Upgrade to ${planType === 'PRO_CREATOR' ? 'Pro Creator (₹299/mo)' : 'VIP Unlimited (₹699/mo)'}`,
        image: 'https://cdn-icons-png.flaticon.com/512/3670/3670125.png',
        // STRICTLY UPI ONLY (PhonePe, GPay, Paytm, BHIM)
        config: {
          display: {
            blocks: {
              upi: {
                name: 'Pay via UPI (PhonePe / GPay / Paytm)',
                instruments: [
                  { method: 'upi' }
                ]
              }
            },
            sequence: ['block.upi'],
            preferences: { show_default_blocks: false }
          }
        },
        handler: async function (response: any) {
          const verifyRes = await fetch('/api/payments/verify-subscription', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: 'ritesh.gupta131290@gmail.com',
              planType,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });
          const verifyData = await verifyRes.json();
          if (verifyRes.ok) {
            alert(`🎉 Success! Your InstaPulse account has been upgraded to ${planType}!`);
            window.location.reload();
          } else {
            alert(verifyData.error || 'Payment verification failed');
          }
        },
        prefill: {
          email: 'ritesh.gupta131290@gmail.com',
          contact: '7500002329',
        },
        theme: {
          color: '#8B5CF6',
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err: any) {
      alert(err.message || 'Error opening UPI checkout');
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <span className="bg-purple-500/10 text-purple-400 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider">
            ⚡ InstaPulse Monetization
          </span>
          <h1 className="text-4xl font-extrabold text-white mt-3">
            Choose Your InstaPulse Plan
          </h1>
          <p className="text-slate-400 mt-2 max-w-xl mx-auto text-sm">
            Scale your Instagram automation with Instant UPI AutoPay (PhonePe, GPay, Paytm). No credit card required!
          </p>

          {/* Current Quota Status Card */}
          <div className="mt-6 inline-flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-5 py-3">
            <div className="text-left">
              <p className="text-xs text-slate-400">Current Active Plan</p>
              <p className="text-sm font-bold text-purple-400">{userStatus.plan} ({userStatus.dmsUsed} / {userStatus.quota} DMs Used)</p>
            </div>
            <div className="w-24 bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-purple-500 h-full transition-all"
                style={{ width: `${Math.min(100, (userStatus.dmsUsed / userStatus.quota) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Pricing Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          
          {/* FREE PLAN */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition">
            <div>
              <span className="text-slate-400 font-medium text-sm">Free Trial</span>
              <div className="mt-4 flex items-baseline">
                <span className="text-4xl font-extrabold text-white">₹0</span>
                <span className="text-slate-400 text-sm ml-1">/ month</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">Perfect for trying out InstaPulse automations.</p>

              <ul className="mt-6 space-y-3 text-sm text-slate-300">
                <li className="flex items-center gap-2">
                  <span className="text-purple-400 font-bold">✓</span> <strong>30 Free DMs</strong> / month
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400 font-bold">✓</span> 1 Active Automation
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400 font-bold">✓</span> 2-Button Card Templates
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400 font-bold">✓</span> Follow-Gate Verification
                </li>
              </ul>
            </div>

            <button
              disabled
              className="mt-8 w-full py-3 rounded-xl font-semibold bg-slate-800 text-slate-400 cursor-default text-sm"
            >
              Current Default Plan
            </button>
          </div>

          {/* PRO CREATOR PLAN (RECOMMENDED) */}
          <div className="bg-gradient-to-b from-purple-900/30 to-slate-900/90 border-2 border-purple-500 rounded-2xl p-6 flex flex-col justify-between relative shadow-xl shadow-purple-500/10">
            <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-purple-600 text-white font-bold text-xs uppercase px-3 py-1 rounded-full tracking-wider shadow">
              🔥 Most Popular
            </span>
            <div>
              <span className="text-purple-400 font-bold text-sm">Pro Creator</span>
              <div className="mt-4 flex items-baseline">
                <span className="text-5xl font-black text-white">₹299</span>
                <span className="text-slate-400 text-sm ml-1">/ month</span>
              </div>
              <p className="text-xs text-purple-300/80 mt-2">For active creators scaling their Instagram audience.</p>

              <ul className="mt-6 space-y-3 text-sm text-slate-200">
                <li className="flex items-center gap-2">
                  <span className="text-purple-400 font-bold">✓</span> <strong>1,000 DMs</strong> / month
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400 font-bold">✓</span> 5 Active Automations
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400 font-bold">✓</span> Fast Zero-Delay Meta Dispatch
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400 font-bold">✓</span> Custom DM Templates & Links
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-purple-400 font-bold">✓</span> <strong>Instant UPI AutoPay</strong> (GPay/PhonePe)
                </li>
              </ul>
            </div>

            <button
              onClick={() => handleSubscribeUPI('PRO_CREATOR')}
              disabled={loadingPlan === 'PRO_CREATOR'}
              className="mt-8 w-full py-3.5 rounded-xl font-bold bg-purple-600 hover:bg-purple-500 text-white transition text-sm shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2"
            >
              {loadingPlan === 'PRO_CREATOR' ? 'Opening UPI Checkout...' : 'Pay ₹299 via UPI (PhonePe / GPay)'}
            </button>
          </div>

          {/* VIP UNLIMITED PLAN */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition">
            <div>
              <span className="text-amber-400 font-bold text-sm">VIP Unlimited</span>
              <div className="mt-4 flex items-baseline">
                <span className="text-4xl font-extrabold text-white">₹699</span>
                <span className="text-slate-400 text-sm ml-1">/ month</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">For high-traffic influencers & digital marketers.</p>

              <ul className="mt-6 space-y-3 text-sm text-slate-300">
                <li className="flex items-center gap-2">
                  <span className="text-amber-400 font-bold">✓</span> <strong>UNLIMITED DMs</strong> / month
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-amber-400 font-bold">✓</span> Unlimited Automations
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-amber-400 font-bold">✓</span> Priority Meta API Server Queue
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-amber-400 font-bold">✓</span> Dedicated WhatsApp Support
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-amber-400 font-bold">✓</span> <strong>Instant UPI AutoPay</strong>
                </li>
              </ul>
            </div>

            <button
              onClick={() => handleSubscribeUPI('VIP_UNLIMITED')}
              disabled={loadingPlan === 'VIP_UNLIMITED'}
              className="mt-8 w-full py-3 rounded-xl font-bold bg-slate-800 hover:bg-slate-700 text-white transition text-sm flex items-center justify-center gap-2"
            >
              {loadingPlan === 'VIP_UNLIMITED' ? 'Opening UPI Checkout...' : 'Pay ₹699 via UPI'}
            </button>
          </div>

        </div>

        {/* UPI Security Badge */}
        <div className="mt-12 text-center bg-slate-900/40 border border-slate-800 rounded-xl p-4 max-w-xl mx-auto flex items-center justify-center gap-3">
          <span className="text-2xl">📱</span>
          <p className="text-xs text-slate-400 text-left">
            <strong className="text-slate-200">100% Secure UPI Payments:</strong> We support Google Pay, PhonePe, Paytm, BHIM, and all Indian Bank UPI apps. Cancel anytime from your InstaPulse dashboard.
          </p>
        </div>
      </div>
    </>
  );
}
