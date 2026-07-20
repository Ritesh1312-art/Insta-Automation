'use client';

import React, { useState, useEffect } from 'react';
import { Activity, RefreshCw, CheckCircle2, AlertCircle, Radio } from 'lucide-react';

export default function LogsPage() {
  const [runs, setRuns] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
        setWebhooks(data.webhooks || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-fuchsia-500" /> Webhook & Execution Logs
          </h1>
          <p className="text-slate-400 text-sm">
            Human-readable correlation traces from Meta Webhook delivery to private DM acceptance.
          </p>
        </div>

        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-xs border border-slate-700"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh Logs
        </button>
      </div>

      {/* Webhook Health Card */}
      <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Webhook Health Status: ACTIVE</div>
            <div className="text-xs text-slate-400">
              Endpoint: <code className="text-fuchsia-300">/api/webhooks/meta</code> (HMAC SHA-256 Enabled)
            </div>
          </div>
        </div>
        <span className="text-xs text-slate-500 font-mono">
          Last Webhook Event: {webhooks[0] ? new Date(webhooks[0].createdAt).toLocaleTimeString() : 'N/A'}
        </span>
      </div>

      {/* Logs Table */}
      <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800 font-bold text-white text-sm">
          Detailed Execution Audit Logs
        </div>

        <div className="divide-y divide-slate-800/60 text-xs">
          {runs.map((run) => (
            <div key={run.id} className="p-4 space-y-1.5 hover:bg-slate-900/40">
              <div className="flex items-center justify-between">
                <span className="font-mono text-slate-400">
                  [{new Date(run.createdAt).toLocaleTimeString()}]
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-mono text-[10px] uppercase ${
                    run.status === 'API_ACCEPTED'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {run.status}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-slate-300">
                <span className="font-bold text-white">{run.automation?.name}</span>
                <span>•</span>
                <span>User: @{run.webhookEvent?.commenterUsername}</span>
                <span>•</span>
                <span className="text-fuchsia-300 font-mono">Comment: "{run.webhookEvent?.commentText}"</span>
              </div>

              <div className="text-[11px] font-mono text-slate-500 truncate">
                Idempotency Key: {run.idempotencyKey}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
