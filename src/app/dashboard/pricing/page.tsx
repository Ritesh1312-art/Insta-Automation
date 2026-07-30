'use client';

import { useState, useEffect } from 'react';

export default function PricingPage() {
  const [userStatus, setUserStatus] = useState({ plan: 'FREE', dmsUsed: 0, quota: 30 });
  const [adminUpiId, setAdminUpiId] = useState('7500002329@ybl');
  const [adminQrCodeUrl, setAdminQrCodeUrl] = useState('');
  
  // Direct UPI Modal State
  const [selectedPlan, setSelectedPlan] = useState<'PRO_CREATOR' | 'VIP_UNLIMITED' | null>(null);
  const [utrInput, setUtrInput] = useState('');
  const [isSubmittingUtr, setIsSubmittingUtr] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);

  useEffect(() => {
    // Fetch user status & admin UPI ID
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

    fetch('/api/admin/upi-settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.adminUpiId) setAdminUpiId(data.adminUpiId);
        if (data.adminQrCodeUrl) setAdminQrCodeUrl(data.adminQrCodeUrl);
      })
      .catch(() => null);
  }, []);

  const openUpiModal = (planType: 'PRO_CREATOR' | 'VIP_UNLIMITED') => {
    setSelectedPlan(planType);
    setUtrInput('');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  const handleVerifyUtr = async () => {
    if (!selectedPlan) return;
    const cleanUtr = utrInput.trim();
    if (!/^\d{12}$/.test(cleanUtr)) {
      alert('⚠️ Please enter a valid 12-digit UTR / Ref Number (e.g. 420192019201)');
      return;
    }

    try {
      setIsSubmittingUtr(true);
      const res = await fetch('/api/payments/direct-upi/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ritesh.gupta131290@gmail.com',
          planType: selectedPlan,
          utrNumber: cleanUtr,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        alert(data.message || '🎉 Success! Your plan is activated!');
        window.location.reload();
      } else {
        alert(data.error || 'Failed to verify UTR Number');
      }
    } catch (err: any) {
      alert(err.message || 'Error submitting UTR verification');
    } finally {
      setIsSubmittingUtr(false);
    }
  };

  const selectedAmount = selectedPlan === 'VIP_UNLIMITED' ? 699 : 299;
  const qrDataUrl = adminQrCodeUrl || `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(`upi://pay?pa=${adminUpiId}&pn=InstaPulse&am=${selectedAmount}&cu=INR`)}`;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-12">
        <span className="bg-purple-500/10 text-purple-400 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider">
          ⚡ InstaPulse Direct Bank UPI (No Razorpay / 0% Fee)
        </span>
        <h1 className="text-4xl font-extrabold text-white mt-3">
          Choose Your InstaPulse Plan
        </h1>
        <p className="text-slate-400 mt-2 max-w-xl mx-auto text-sm">
          Pay 100% directly to Admin Bank Account via PhonePe, Google Pay, or Paytm. 0% Gateway Fees. Instant 12-Digit UTR Activation!
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
                <span className="text-purple-400 font-bold">✓</span> <strong>Direct PhonePe / GPay / Paytm UPI</strong>
              </li>
            </ul>
          </div>

          <button
            onClick={() => openUpiModal('PRO_CREATOR')}
            className="mt-8 w-full py-3.5 rounded-xl font-bold bg-purple-600 hover:bg-purple-500 text-white transition text-sm shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2"
          >
            Pay ₹299 via Direct UPI QR
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
                <span className="text-amber-400 font-bold">✓</span> <strong>Direct PhonePe / GPay / Paytm UPI</strong>
              </li>
            </ul>
          </div>

          <button
            onClick={() => openUpiModal('VIP_UNLIMITED')}
            className="mt-8 w-full py-3 rounded-xl font-bold bg-slate-800 hover:bg-slate-700 text-white transition text-sm flex items-center justify-center gap-2"
          >
            Pay ₹699 via Direct UPI QR
          </button>
        </div>

      </div>

      {/* DIRECT UPI MODAL WITH Dynamic QR Code & 12-Digit UTR Input */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-purple-500/50 rounded-3xl p-6 max-w-md w-full shadow-2xl relative space-y-5">
            
            {/* Close Button */}
            <button
              onClick={() => setSelectedPlan(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg bg-slate-900 border border-slate-800 font-bold text-sm"
            >
              ✕
            </button>

            {/* Modal Title */}
            <div className="text-center">
              <span className="bg-purple-500/20 text-purple-300 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                Direct Bank Payment (0% Gateway Fee)
              </span>
              <h2 className="text-2xl font-black text-white mt-2">
                Pay ₹{selectedAmount} via Direct UPI
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Scan QR Code or pay directly to Admin UPI ID below:
              </p>
            </div>

            {/* Dynamic QR Code Display */}
            <div className="bg-white p-4 rounded-2xl w-48 h-48 mx-auto flex items-center justify-center shadow-lg border-4 border-purple-500/50">
              <img
                src={qrDataUrl}
                alt="Direct UPI Scan QR Code"
                className="w-full h-full object-contain"
              />
            </div>

            {/* Copy UPI ID Box */}
            <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">Admin PhonePe / GPay / Paytm UPI ID</span>
                <span className="text-sm font-bold font-mono text-purple-300">{adminUpiId}</span>
              </div>
              <button
                onClick={() => copyToClipboard(adminUpiId)}
                className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow"
              >
                {copiedUpi ? '✓ Copied!' : 'Copy UPI ID'}
              </button>
            </div>

            {/* Step-by-Step Instructions in Hinglish */}
            <div className="bg-purple-950/40 border border-purple-800/50 rounded-xl p-3.5 space-y-1.5 text-xs text-slate-200">
              <h4 className="font-bold text-purple-300 flex items-center gap-1 text-xs">
                📌 Payment & 12-Digit UTR Instructions:
              </h4>
              <p>1️⃣ Upar diya QR Code scan karein ya UPI ID copy karke PhonePe / GPay / Paytm se exact <strong>₹{selectedAmount}</strong> pay karein.</p>
              <p>2️⃣ Payment complete hone ke baad receipt se <strong>12-digit UTR / Ref No.</strong> copy karein.</p>
              <p>3️⃣ Niche 12-digit UTR No. paste karke Confirm button click karein!</p>
            </div>

            {/* 12-Digit UTR Input Form */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-200">
                Enter 12-Digit UTR / Ref Number:
              </label>
              <input
                type="text"
                maxLength={12}
                value={utrInput}
                onChange={(e) => setUtrInput(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 420192019201"
                className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-center text-lg font-bold tracking-widest focus:outline-none focus:border-purple-500"
              />
            </div>

            {/* Submit Button */}
            <button
              onClick={handleVerifyUtr}
              disabled={isSubmittingUtr || utrInput.trim().length !== 12}
              className="w-full py-3.5 rounded-xl font-extrabold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm shadow-lg shadow-purple-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmittingUtr ? 'Verifying UTR...' : 'Confirm & Activate Plan 🚀'}
            </button>

          </div>
        </div>
      )}
    </div>
  );
}
