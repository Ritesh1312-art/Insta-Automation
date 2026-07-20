'use client';

import React from 'react';
import { Settings, ShieldAlert, Key, HelpCircle, FileText, CheckCircle2 } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-fuchsia-500" /> Platform Settings & Meta Developer Guide
        </h1>
        <p className="text-slate-400 text-sm">
          System environment configuration and step-by-step Meta App setup guide.
        </p>
      </div>

      {/* Meta App Configuration Guide (Section 5) */}
      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-fuchsia-400" /> Meta Developer App Setup Guide
        </h2>

        <div className="space-y-3 text-xs text-slate-300">
          <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
            <h3 className="font-bold text-white text-sm">1. Create Meta Developer Application</h3>
            <p>
              Go to <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-fuchsia-400 underline">Meta Developer Portal</a>, create a new App under <strong>Business</strong> use case. Add <strong>Instagram Graph API</strong> and <strong>Webhooks</strong> products.
            </p>
          </div>

          <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
            <h3 className="font-bold text-white text-sm">2. Webhook Callback URL & Verify Token</h3>
            <div className="font-mono bg-slate-950 p-3 rounded border border-slate-800 space-y-1 text-slate-200">
              <div>Callback URL: <span className="text-emerald-400">https://your-domain.com/api/webhooks/meta</span></div>
              <div>Verify Token: <span className="text-fuchsia-300">my_custom_webhook_verify_token_123</span></div>
              <div>Subscribed Field: <span className="text-amber-300">comments</span> under <span className="text-slate-100">instagram</span> object</div>
            </div>
          </div>

          <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
            <h3 className="font-bold text-white text-sm">3. Required Meta Permissions</h3>
            <div className="flex flex-wrap gap-2 pt-1 font-mono text-[11px]">
              <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-fuchsia-300">instagram_basic</span>
              <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-fuchsia-300">instagram_manage_comments</span>
              <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-fuchsia-300">instagram_manage_messages</span>
              <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-fuchsia-300">pages_read_engagement</span>
              <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-fuchsia-300">pages_show_list</span>
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone / Emergency Switch */}
      <div className="bg-rose-950/20 p-6 rounded-2xl border border-rose-900/50 space-y-4">
        <h2 className="text-lg font-bold text-rose-300 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-400" /> Emergency Kill Switch & Danger Zone
        </h2>
        <p className="text-xs text-rose-200">
          Immediately pause all active automations or clear cached data if needed.
        </p>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            onClick={() => alert('Emergency Kill Switch activated: All automations paused.')}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs shadow-lg shadow-rose-600/30"
          >
            Pause All Automations
          </button>
        </div>
      </div>
    </div>
  );
}
