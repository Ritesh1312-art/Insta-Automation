'use client';

import React, { useState } from 'react';
import { Settings, ShieldAlert, HelpCircle } from 'lucide-react';

export default function SettingsPage() {
  const [message, setMessage] = useState('');
  const pauseAll = async () => {
    if (!confirm('Pause every active automation? No messages will be sent until you reactivate them.')) return;
    const response = await fetch('/api/automations/pause-all', { method: 'POST' });
    const data = await response.json();
    setMessage(response.ok ? `${data.paused} automation(s) paused.` : data.error || 'Unable to pause automations.');
  };
  const handleLogout = async () => {
    if (!confirm('Are you sure you want to log out?')) return;
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        window.location.href = '/login';
      } else {
        alert('Failed to log out');
      }
    } catch (err) {
      alert('Error logging out');
    }
  };

  const [adminUpiId, setAdminUpiId] = useState('');
  const [adminQrCodeUrl, setAdminQrCodeUrl] = useState('');
  const [upiSaveStatus, setUpiSaveStatus] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  React.useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => setIsAdmin(data.user?.role === 'ADMIN'))
      .catch(() => setIsAdmin(false));
    fetch('/api/admin/upi-settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.adminUpiId) setAdminUpiId(data.adminUpiId);
        if (data.adminQrCodeUrl) setAdminQrCodeUrl(data.adminQrCodeUrl);
      })
      .catch(() => null);
  }, []);

  const saveUpiSettings = async () => {
    try {
      setUpiSaveStatus('Saving...');
      const res = await fetch('/api/admin/upi-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUpiId, adminQrCodeUrl }),
      });
      const data = await res.json();
      if (res.ok) {
        setUpiSaveStatus('✅ Admin UPI ID & Settings saved successfully!');
      } else {
        setUpiSaveStatus(`❌ ${data.error || 'Failed to save UPI settings'}`);
      }
    } catch (err: any) {
      setUpiSaveStatus(`❌ ${err.message || 'Error saving UPI settings'}`);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-fuchsia-500" /> Platform Settings & Meta Developer Guide
        </h1>
        <p className="text-slate-400 text-sm">System environment configuration and Meta App setup guide.</p>
      </div>

      {isAdmin && <div className="bg-gradient-to-br from-slate-950 to-purple-950/40 p-6 rounded-2xl border border-purple-500/30 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            📲 Direct UPI Payment Settings (100% Direct Bank Money)
          </h2>
          <span className="bg-purple-500/20 text-purple-300 text-xs px-2.5 py-1 rounded-full font-semibold">
            0% Gateway Fees
          </span>
        </div>
        <p className="text-xs text-slate-300">
          Enter the PhonePe / GPay / Paytm UPI ID customers should pay. Plans activate only after you approve the UTR.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Admin UPI ID (PhonePe / GPay / Paytm / BHIM):
            </label>
            <input
              type="text"
              value={adminUpiId}
              onChange={(e) => setAdminUpiId(e.target.value)}
              placeholder="e.g. 7500002329@ybl or ritesh@paytm"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:border-purple-500 font-mono"
            />
            <p className="text-[11px] text-slate-400 mt-1">This UPI ID is displayed on customer checkout & scan QR code.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Custom UPI QR Code Image URL (Optional):
            </label>
            <input
              type="text"
              value={adminQrCodeUrl}
              onChange={(e) => setAdminQrCodeUrl(e.target.value)}
              placeholder="https://... (Leave blank to use auto-generated QR code)"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:border-purple-500 font-mono"
            />
            <p className="text-[11px] text-slate-400 mt-1">If blank, InstaPulse automatically generates dynamic UPI QR code.</p>
          </div>
        </div>

        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={saveUpiSettings}
            className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 transition-all flex items-center gap-2"
          >
            💾 Save Admin UPI Settings
          </button>
          {upiSaveStatus && (
            <span className="text-xs font-semibold text-purple-300">{upiSaveStatus}</span>
          )}
        </div>
      </div>}

      {/* Account & Session Section */}
      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          🔐 Account & Session Management
        </h2>
        <p className="text-xs text-slate-400">
          Sign out of your current workspace session across this browser.
        </p>
        <button
          onClick={handleLogout}
          className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-lg shadow-rose-600/30 transition-all flex items-center gap-2"
        >
          🚪 Log Out of Account
        </button>
      </div>

      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-fuchsia-400" /> Meta Developer App Setup Guide
        </h2>
        <div className="space-y-3 text-xs text-slate-300">
          <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
            <h3 className="font-bold text-white text-sm">Webhook Callback</h3>
            <div className="font-mono bg-slate-950 p-3 rounded border border-slate-800 space-y-1 text-slate-200">
              <div>Callback URL: <span className="text-emerald-400">/api/webhooks/meta on this domain</span></div>
              <div>Verify Token: <span className="text-fuchsia-300">Must equal META_VERIFY_TOKEN</span></div>
              <div>Subscribed fields: <span className="text-amber-300">comments, messages, messaging_postbacks</span></div>
            </div>
          </div>
          <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
            <h3 className="font-bold text-white text-sm">Required Meta Permissions</h3>
            <div className="flex flex-wrap gap-2 pt-1 font-mono text-[11px]">
              {['instagram_basic', 'instagram_manage_comments', 'instagram_manage_messages', 'pages_read_engagement', 'pages_show_list', 'pages_manage_metadata'].map((permission) => (
                <span key={permission} className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-fuchsia-300">{permission}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-rose-950/20 p-6 rounded-2xl border border-rose-900/50 space-y-4">
        <h2 className="text-lg font-bold text-rose-300 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-400" /> Emergency Kill Switch
        </h2>
        <p className="text-xs text-rose-200">Immediately pauses all active automations.</p>
        <div className="flex flex-wrap gap-3 pt-2">
          <button onClick={pauseAll} className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs shadow-lg shadow-rose-600/30">
            Pause All Automations
          </button>
          {message && <p className="text-xs text-rose-200 self-center">{message}</p>}
        </div>
      </div>
    </div>
  );
}
