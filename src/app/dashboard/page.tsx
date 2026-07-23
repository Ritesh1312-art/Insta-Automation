'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Instagram,
  Zap,
  MessageSquare,
  Send,
  CheckCircle2,
  AlertCircle,
  Play,
  ArrowRight,
  RefreshCw,
  Plus,
  Radio,
} from 'lucide-react';

export default function DashboardOverview() {
  const [stats, setStats] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [mediaList, setMediaList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live configuration validation state
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);

  useEffect(() => {
    fetchDashboardData();
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'meta_connection_failed') {
      setErrorMessage('meta_connection_failed');
    }
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [statsRes, logsRes, mediaRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/logs'),
        fetch('/api/media'),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (logsRes.ok) {
        const logData = await logsRes.json();
        setLogs(logData.runs || []);
      }
      if (mediaRes.ok) {
        const mediaData = await mediaRes.json();
        setMediaList(mediaData.media || []);
        if (mediaData.media?.length > 0) {
          setSelectedMediaId(mediaData.media[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectMeta = async () => {
    try {
      const res = await fetch('/api/auth/meta/url');
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      alert('Failed to launch Meta Auth flow');
    }
  };

  const handleDisconnectMeta = async () => {
    if (!confirm('Are you sure you want to disconnect your Instagram account?')) return;
    try {
      const res = await fetch('/api/auth/meta/disconnect', { method: 'POST' });
      if (res.ok) {
        fetchDashboardData();
      } else {
        alert('Failed to disconnect account');
      }
    } catch (err) {
      alert('Error disconnecting account');
    }
  };

  const handleValidateConfiguration = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidating(true);
    setValidationResult(null);

    try {
      const res = await fetch('/api/automations/test-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId: selectedMediaId,
        }),
      });

      const data = await res.json();
      setValidationResult(data);
    } catch (err: any) {
      setValidationResult({ error: err.message || 'Validation error' });
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950 p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fuchsia-400 mb-1">
            <Radio className="w-3.5 h-3.5 animate-pulse text-fuchsia-500" />
            Meta Webhook Event Engine Active
          </div>
          <h1 className="text-2xl font-bold text-white">Instagram Comment-to-DM Platform</h1>
          <p className="text-slate-400 text-sm mt-1">
            Deterministic, post-specific automated Meta Graph API private replies.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setTestModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm border border-slate-700 transition-all shadow-md"
          >
            <Play className="w-4 h-4 text-emerald-400 fill-emerald-400" />
            Validate Automation Setup
          </button>

          {stats?.connectionStatus === 'CONNECTED' ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" /> Connected as @{stats?.instagramUsername}
              </div>
              <button
                onClick={handleDisconnectMeta}
                className="px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-sm font-medium transition-all"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectMeta}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl gradient-ig hover:opacity-95 text-white font-medium text-sm shadow-lg shadow-fuchsia-500/25 transition-all"
            >
              <Instagram className="w-4 h-4" /> Connect Instagram Account
            </button>
          )}
        </div>
      </div>

      {/* Connection Failure Alert Box */}
      {errorMessage === 'meta_connection_failed' && (
        <div className="bg-rose-950/40 border border-rose-800 p-6 rounded-2xl space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-white text-base">⚠️ Instagram Connection Loop Detected!</h3>
              <p className="text-slate-300 text-xs mt-1.5 leading-relaxed">
                Meta (Facebook) ne is login attempt mein **koyi bhi Facebook Page ya Instagram Account return nahi kiya**. 
                Yeh tab hota hai jab aap login dialog popup mein **apne Page aur Instagram Account ke checkboxes ko tick karna bhool jaate hain**.
              </p>
            </div>
          </div>
          
          <div className="bg-slate-950/60 p-4 rounded-xl border border-rose-950 text-xs space-y-2.5 text-slate-300">
            <h4 className="font-semibold text-rose-400">Fix karne ke 3 simple steps:</h4>
            <ol className="list-decimal pl-4 space-y-2">
              <li>
                <strong>Facebook settings se App clear karein (Recommended):</strong><br />
                Apne Facebook account par jayein → <strong>Settings & Privacy</strong> → <strong>Settings</strong> → <strong>Business Integrations</strong>. Niche list mein se <strong>"InstaDM Auto"</strong> (ya aapka app name) ko <strong>Remove</strong> kar dein.
              </li>
              <li>
                <strong>"Edit Settings" par click karein:</strong><br />
                Iske baad wapas upar <strong>"Connect Instagram Account"</strong> button par click karein. Jab Facebook popup aaye, to <strong>"Edit Settings"</strong> ya <strong>"Reconnect"</strong> par click karein.
              </li>
              <li>
                <strong>Checkboxes ko tick karein:</strong><br />
                Wizards mein clear check boxes aayenge:
                <ul className="list-disc pl-4 mt-1 space-y-1 text-slate-400">
                  <li>Apne us <strong>Instagram Creator/Business Account</strong> ko tick karein jise connect karna hai.</li>
                  <li>Apne us <strong>Facebook Page</strong> ko select karein jo aapke Instagram se connected hai.</li>
                  <li>Saari requested permissions ko <strong>"Yes"</strong> par select karein.</li>
                </ul>
              </li>
            </ol>
          </div>
        </div>
      )}


      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
            <span>ACTIVE AUTOMATIONS</span>
            <Zap className="w-4 h-4 text-fuchsia-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">
            {stats?.activeAutomations || 0}{' '}
            <span className="text-xs font-normal text-slate-500">/ {stats?.totalAutomations || 0} total</span>
          </div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1">
            Post-specific comment triggers
          </div>
        </div>

        <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
            <span>WEBHOOK COMMENTS DETECTED</span>
            <MessageSquare className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">
            {stats?.totalCommentsReceived || 0}
          </div>
          <div className="text-xs text-slate-400 mt-2">Parsed from Meta webhooks</div>
        </div>

        <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
            <span>PERMITTED DMs DISPATCHED</span>
            <Send className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-extrabold text-emerald-400">
            {stats?.totalSuccess || 0}
          </div>
          <div className="text-xs text-slate-400 mt-2">Private reply API acceptance</div>
        </div>

        <div className="bg-slate-950 p-5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-3">
            <span>SUCCESS RATE</span>
            <CheckCircle2 className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-3xl font-extrabold text-white">{stats?.successRate || 100}%</div>
          <div className="text-xs text-slate-400 mt-2">Idempotent execution rate</div>
        </div>
      </div>

      {/* Quick Reels Overview Section */}
      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Connected Instagram Content & Automations</h2>
            <p className="text-xs text-slate-400">
              Each Reel maps deterministically to its own resource & comment trigger rule.
            </p>
          </div>
          <Link
            href="/dashboard/automations"
            className="flex items-center gap-1.5 text-xs font-semibold text-fuchsia-400 hover:text-fuchsia-300"
          >
            Create New Automation <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {mediaList.slice(0, 3).map((item) => (
            <div
              key={item.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] uppercase">
                    {item.mediaType}
                  </span>
                  <span className="text-slate-500">ID: {item.instagramMediaId.slice(-6)}</span>
                </div>
                <p className="text-xs text-slate-200 line-clamp-2 font-medium mb-3">
                  {item.caption || 'No caption available'}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                {item.automations && item.automations.length > 0 ? (
                  <span className="flex items-center gap-1 text-emerald-400 font-medium">
                    <Zap className="w-3.5 h-3.5" /> {item.automations[0].name}
                  </span>
                ) : (
                  <span className="text-slate-500">No automation attached</span>
                )}
                <button
                  onClick={() => {
                    setSelectedMediaId(item.id);
                    setTestModalOpen(true);
                  }}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium"
                >
                  Validate
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity Table */}
      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Recent Automation Deliveries</h2>
          <button
            onClick={fetchDashboardData}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm">
            No live automation triggers have been logged yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Automation</th>
                  <th className="px-4 py-3">Commenter</th>
                  <th className="px-4 py-3">Comment Text</th>
                  <th className="px-4 py-3">DM Status</th>
                  <th className="px-4 py-3">Idempotency Key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {logs.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-900/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-slate-400">
                      {new Date(run.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-200">
                      {run.automation?.name || 'Comment Trigger'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      @{run.webhookEvent?.commenterUsername || 'user'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-fuchsia-300">
                        "{run.webhookEvent?.commentText}"
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {run.status === 'API_ACCEPTED' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> DELIVERED (API 200)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                          <AlertCircle className="w-3.5 h-3.5" /> {run.errorCategory || 'FAILED'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500 text-[10px] truncate max-w-[150px]">
                      {run.idempotencyKey}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Live configuration validator */}
      {testModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Play className="w-5 h-5 text-emerald-400" /> Automation Configuration Check
              </h3>
              <button
                onClick={() => setTestModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleValidateConfiguration} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Select Reel / Post
                </label>
                <select
                  value={selectedMediaId}
                  onChange={(e) => setSelectedMediaId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-fuchsia-500"
                >
                  {mediaList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.caption?.slice(0, 45) || m.instagramMediaId}
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-slate-400">This checks the selected post's real connected-account automation configuration. It does not create a comment or send a DM.</p>

              <button
                type="submit"
                disabled={validating || !selectedMediaId}
                className="w-full py-2.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium text-sm shadow-lg shadow-fuchsia-600/30 transition-all flex items-center justify-center gap-2"
              >
                {validating ? 'Checking configuration...' : 'Check Live Configuration'}
              </button>
            </form>

            {validationResult && (
              <div
                className={`p-4 rounded-xl text-xs font-mono border space-y-2 ${
                  validationResult.ready
                    ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-800 text-rose-200'
                }`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  {validationResult.ready ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                  )}
                  {validationResult.ready ? 'Ready for real Meta comments' : 'Configuration needs attention'}
                </div>
                <div>{validationResult.message || validationResult.error}</div>
                {validationResult.blockers?.map((blocker: string) => <div key={blocker}>• {blocker}</div>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
