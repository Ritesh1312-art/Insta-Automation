'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, Camera, Film, MessageCircle, Send, Sparkles, Zap } from 'lucide-react';
import { subscribeToStudioStatsRefresh } from '@/lib/studio-refresh';
import { webhookSetupIncomplete } from '@/lib/meta-webhook-status';

type StudioStats = {
  totalAutomations: number;
  activeAutomations: number;
  totalCommentsReceived: number;
  totalRuns: number;
  totalSuccess: number;
  totalFailed: number;
  successRate: number;
  connectionStatus: string;
  webhookStatus: string;
  instagramUsername: string | null;
  plan: string;
  monthlyDmQuota: number;
  dmsUsedThisMonth: number;
  subscriptionStatus: string;
  role?: string;
};

type RecentRun = {
  id: string;
  status: string;
  createdAt: string;
  automation?: { name?: string } | null;
  webhookEvent?: { commenterUsername?: string | null; commentText?: string | null } | null;
};

export default function DashboardOverview() {
  const [stats, setStats] = useState<StudioStats | null>(null);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState(false);
  const [webhookWarning, setWebhookWarning] = useState(false);

  const latestRequest = useRef(0);

  // Background refreshes keep the current numbers on screen (no skeleton);
  // only the newest response is applied if refreshes overlap.
  const load = useCallback(async (background = false) => {
    const request = ++latestRequest.current;
    if (!background) {
      setLoading(true);
      setError('');
    }
    try {
      const [statsResponse, logsResponse] = await Promise.all([
        fetch('/api/stats', { cache: 'no-store' }),
        fetch('/api/logs', { cache: 'no-store' }),
      ]);
      const [statsData, logsData] = await Promise.all([
        statsResponse.json(),
        logsResponse.json(),
      ]);
      if (!statsResponse.ok) throw new Error(statsData.error || 'Studio status load nahi ho paaya');
      if (!logsResponse.ok) throw new Error(logsData.error || 'Latest activity load nahi ho paayi');
      if (request !== latestRequest.current) return;
      setStats(statsData);
      setRecentRuns((logsData.runs || []).slice(0, 5));
      setError('');
    } catch (loadError) {
      if (request !== latestRequest.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Studio load nahi ho paaya');
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setConnectionError(params.get('error') === 'meta_connection_failed');
    setWebhookWarning(params.get('webhookWarning') === 'true');
    void load();
    // Refetch when Studio is revisited or becomes visible, or when flows or
    // analytics change elsewhere, so it never shows stale totals.
    return subscribeToStudioStatsRefresh(() => { void load(true); });
  }, [load]);

  const handleConnectMeta = async () => {
    setError('');
    try {
      const response = await fetch('/api/auth/meta/url');
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || 'Instagram connection start nahi ho paaya');
      window.location.href = data.url;
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Instagram connection start nahi ho paaya');
    }
  };

  const linkedStatuses = ['CONNECTED', 'TOKEN_EXPIRING', 'TOKEN_EXPIRED', 'ERROR'];
  const connected = Boolean(stats && linkedStatuses.includes(stats.connectionStatus));
  // Token/connection state and webhook-subscription state are reported
  // separately: a failed webhook subscribe on a healthy token must not tell the
  // creator to reconnect Instagram.
  const tokenExpired = stats?.connectionStatus === 'TOKEN_EXPIRED';
  const connectionFailed = stats?.connectionStatus === 'ERROR';
  const reconnectRequired = tokenExpired || connectionFailed;
  // A webhook gap only matters while the connection itself is usable; when a
  // reconnect is already being asked for, that instruction comes first.
  const webhookSetupWarning = (webhookWarning || webhookSetupIncomplete(stats?.webhookStatus))
    && connected
    && !reconnectRequired;
  const quotaPercent = stats
    ? Math.min(100, Math.round((stats.dmsUsedThisMonth / Math.max(stats.monthlyDmQuota, 1)) * 100))
    : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(251,113,133,0.18),rgba(88,28,135,0.35)_40%,rgba(9,9,11,0.9))] p-6 md:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-fuchsia-300">Studio</p>
            <h1 className="font-display mt-2 text-4xl font-black tracking-tight text-white md:text-5xl">
              {connected ? `Hey @${stats?.instagramUsername}` : 'Instagram automation dashboard'}
            </h1>
            <p className="mt-3 max-w-xl text-sm text-zinc-300">
              Account connection, DM quota, flow performance aur latest activity ka quick overview.
            </p>
          </div>
          {!connected || reconnectRequired ? (
            <button onClick={handleConnectMeta} className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-zinc-950">
              <Camera className="h-4 w-4" /> {reconnectRequired ? 'Reconnect Instagram' : 'Connect Instagram'}
            </button>
          ) : (
            <div className="flex gap-2">
              <Link href="/dashboard/content" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-zinc-950">
                <Film className="h-4 w-4" /> Posts
              </Link>
              <Link href="/dashboard/automations" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white">
                <Zap className="h-4 w-4" /> Flows
              </Link>
            </div>
          )}
        </div>
      </section>

      {connectionError && (
        <div className="flex gap-2 rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Meta ne connected Page/Instagram account return nahi kiya. Dobara connect karke Page aur Instagram dono select karo.</span>
        </div>
      )}
      {!connectionError && tokenExpired && (
        <div className="flex gap-2 rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Instagram token invalid ya expired hai. Automations resume karne ke liye reconnect karo.</span>
        </div>
      )}
      {!connectionError && !tokenExpired && connectionFailed && (
        <div className="flex gap-2 rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Instagram connection error state mein hai. Dobara connect karke access confirm karo — token expire hone ka claim verified nahi hai.</span>
        </div>
      )}
      {webhookSetupWarning && (
        <div className="flex gap-2 rounded-2xl border border-amber-400/40 bg-amber-950/30 p-4 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Instagram connection theek hai, lekin Meta webhook subscription poora nahi hua — naye comments/messages aane par automations trigger nahi honge. Reconnect karne ki zaroorat nahi hai.{' '}
            {stats?.role === 'ADMIN'
              ? <span><Link href="/dashboard/settings" className="underline">Settings</Link> se webhook subscription dobara karo.</span>
              : <span>Admin/support se webhook subscription dobara karwao.</span>}
          </span>
        </div>
      )}
      {error && <p role="alert" className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">{error}</p>}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-3xl bg-white/5" />)}
        </div>
      ) : stats ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Zap className="h-5 w-5" />} label="Active flows" value={`${stats.activeAutomations}/${stats.totalAutomations}`} />
            <StatCard icon={<MessageCircle className="h-5 w-5" />} label="Comments received" value={String(stats.totalCommentsReceived)} />
            <StatCard icon={<Send className="h-5 w-5" />} label="Successful sends" value={String(stats.totalSuccess)} />
            <StatCard icon={<Activity className="h-5 w-5" />} label="Success rate" value={`${stats.successRate}%`} />
          </section>

          <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-300">DM quota</p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div><p className="text-3xl font-black text-white">{stats.dmsUsedThisMonth}</p><p className="text-sm text-zinc-400">of {stats.monthlyDmQuota} used</p></div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-zinc-200">{stats.plan} · {stats.subscriptionStatus}</span>
              </div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-fuchsia-500 to-amber-400" style={{ width: `${quotaPercent}%` }} /></div>
              <Link href="/dashboard/pricing" className="mt-4 inline-block text-xs font-semibold text-fuchsia-300">Plans dekho →</Link>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div><p className="font-semibold text-white">Latest activity</p><p className="text-xs text-zinc-500">Recent automation executions</p></div>
                <Link href="/dashboard/logs" className="text-xs font-semibold text-fuchsia-300">All logs →</Link>
              </div>
              <div className="divide-y divide-white/10">
                {recentRuns.map((run) => (
                  <div key={run.id} className="flex items-center gap-3 px-5 py-3 text-xs">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${run.status === 'API_ACCEPTED' ? 'bg-emerald-400' : run.status === 'FAILED' ? 'bg-rose-400' : 'bg-amber-300'}`} />
                    <div className="min-w-0 flex-1"><p className="truncate font-medium text-zinc-200">{run.automation?.name || 'Automation'}</p><p className="truncate text-zinc-500">@{run.webhookEvent?.commenterUsername || 'unknown'} · {run.webhookEvent?.commentText || 'interaction'}</p></div>
                    <span className="shrink-0 text-zinc-600">{new Date(run.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
                {!recentRuns.length && <div className="p-8 text-center text-sm text-zinc-500"><Sparkles className="mx-auto mb-2 h-5 w-5" />Abhi koi automation activity nahi hai.</div>}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="text-fuchsia-300">{icon}</div>
      <p className="mt-5 text-3xl font-black text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{label}</p>
    </div>
  );
}
