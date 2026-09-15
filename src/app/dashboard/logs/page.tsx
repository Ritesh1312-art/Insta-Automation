'use client';

import { useEffect, useState } from 'react';
import { Activity, MousePointerClick, Radio, RefreshCw } from 'lucide-react';

type AuditDetails = {
  buttonAction?: string;
  senderId?: string;
  automationId?: string;
  outcome?: string;
};

export default function LogsPage() {
  const [runs, setRuns] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [postbackAudits, setPostbackAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/logs');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load logs');
      setRuns(data.runs || []);
      setWebhooks(data.webhooks || []);
      setPostbackAudits(data.postbackAudits || []);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to load logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><Activity className="h-6 w-6 text-fuchsia-500" /> Webhook & Execution Logs</h1>
          <p className="text-sm text-slate-400">Correlation traces from Meta delivery through DM-button outcomes.</p>
        </div>
        <button onClick={fetchLogs} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-100 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh Logs
        </button>
      </div>
      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}

      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950 p-5 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><Radio className="h-5 w-5 animate-pulse" /></div>
          <div><div className="text-sm font-bold text-white">Webhook endpoint active</div><code className="text-xs text-fuchsia-300">/api/webhooks/meta · HMAC SHA-256</code></div>
        </div>
        <span className="font-mono text-xs text-slate-500">Last event: {webhooks[0] ? new Date(webhooks[0].createdAt).toLocaleString() : 'N/A'}</span>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <div className="flex items-center gap-2 border-b border-slate-800 p-4 text-sm font-bold text-white"><MousePointerClick className="h-4 w-4 text-fuchsia-400" /> DM button audit trail</div>
        <div className="divide-y divide-slate-800/60 text-xs">
          {postbackAudits.map((audit) => {
            const details = (audit.details || {}) as AuditDetails;
            return (
              <div key={audit.id} className="grid gap-2 p-4 hover:bg-slate-900/40 md:grid-cols-[170px_150px_1fr]">
                <span className="font-mono text-slate-500">{new Date(audit.createdAt).toLocaleString()}</span>
                <span className={`font-mono font-bold ${audit.action === 'POSTBACK_PROCESSED' ? 'text-emerald-400' : audit.action === 'POSTBACK_FAILED' ? 'text-rose-400' : 'text-amber-300'}`}>{audit.action}</span>
                <div><span className="text-fuchsia-300">{details.buttonAction || 'UNKNOWN'}</span><span className="text-slate-500"> · IGSID {details.senderId || '—'}</span><p className="mt-1 text-slate-300">{details.outcome || 'No outcome message'}</p></div>
              </div>
            );
          })}
          {!postbackAudits.length && <p className="p-8 text-center text-slate-500">No DM-button activity yet.</p>}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <div className="border-b border-slate-800 p-4 text-sm font-bold text-white">Automation executions</div>
        <div className="divide-y divide-slate-800/60 text-xs">
          {runs.map((run) => (
            <div key={run.id} className="space-y-1.5 p-4 hover:bg-slate-900/40">
              <div className="flex items-center justify-between"><span className="font-mono text-slate-400">{new Date(run.createdAt).toLocaleString()}</span><span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${run.status === 'API_ACCEPTED' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-rose-500/30 bg-rose-500/10 text-rose-400'}`}>{run.status}</span></div>
              <div className="flex flex-wrap gap-2 text-slate-300"><strong className="text-white">{run.automation?.name}</strong><span>· @{run.webhookEvent?.commenterUsername || 'unknown'}</span><span className="text-fuchsia-300">“{run.webhookEvent?.commentText}”</span></div>
              <div className="truncate font-mono text-[11px] text-slate-600">{run.idempotencyKey}</div>
            </div>
          ))}
          {!runs.length && <p className="p-8 text-center text-slate-500">No automation executions yet.</p>}
        </div>
      </section>
    </div>
  );
}
