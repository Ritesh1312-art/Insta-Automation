'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Instagram, RefreshCw, Sparkles } from 'lucide-react';
import PostCard from '@/components/PostCard';
import AutomationComposer from '@/components/AutomationComposer';
import type { StudioPost } from '@/components/studio';

export default function DashboardOverview() {
  const [stats, setStats] = useState<any>(null);
  const [posts, setPosts] = useState<StudioPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [picked, setPicked] = useState<StudioPost | null>(null);
  const [toast, setToast] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState('');
  const [reauthRequired, setReauthRequired] = useState(false);

  const load = async (sync = false) => {
    if (sync) setSyncing(true);
    setLoading(true);
    setSyncError('');
    try {
      const [statsRes, mediaRes] = await Promise.all([
        fetch('/api/stats'),
        fetch(`/api/media${sync ? '?sync=true' : ''}`),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      const mediaData = await mediaRes.json();
      if (!mediaRes.ok) throw new Error(mediaData.error || 'Unable to load Instagram posts');
      setPosts(mediaData.media || []);
      setReauthRequired(Boolean(mediaData.reauthorizationRequired));
      if (mediaData.syncError) {
        setSyncError(`Instagram sync failed, so your cached posts are shown: ${mediaData.syncError}`);
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Unable to load Instagram posts');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'meta_connection_failed') setErrorMessage('meta_connection_failed');
    const justConnected = params.get('connected') === 'true';
    if (justConnected) setToast('Connected. Your Reels are on the board — tap one to drop an auto-DM.');
    const already = sessionStorage.getItem('ig-synced');
    load(justConnected || !already).then(() => sessionStorage.setItem('ig-synced', '1'));
  }, []);

  const handleConnectMeta = async () => {
    const res = await fetch('/api/auth/meta/url');
    const data = await res.json();
    if (data.url) window.location.href = data.url;
  };

  // TOKEN_EXPIRED still means an account IS linked: keep showing the studio and the
  // cached posts, plus the reconnect banner, instead of the "connect first" state.
  const linkedStatuses = ['CONNECTED', 'TOKEN_EXPIRING', 'TOKEN_EXPIRED', 'ERROR'];
  const connected = linkedStatuses.includes(stats?.connectionStatus);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(251,113,133,0.18),rgba(88,28,135,0.35)_40%,rgba(9,9,11,0.9))] p-6 md:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-fuchsia-300">Studio</p>
            <h1 className="font-display mt-2 text-4xl font-black tracking-tight text-white md:text-5xl">
              {connected ? `Hey @${stats.instagramUsername}` : 'Your Reels. One tap auto-DM.'}
            </h1>
            <p className="mt-3 max-w-xl text-sm text-zinc-300">
              Connect ke baad yahan asli posts dikhti hain — thumbnail, caption, poori. Naam ki list nahi. Post pe tap, message likho, live.
            </p>
            {connected && (
              <p className="mt-4 text-xs text-zinc-400">
                {stats.plan} · {stats.dmsUsedThisMonth}/{stats.monthlyDmQuota} DMs this cycle
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {connected ? (
              <button
                onClick={() => load(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Pulling Reels…' : 'Refresh posts'}
              </button>
            ) : (
              <button onClick={handleConnectMeta} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-zinc-950">
                <Instagram className="h-4 w-4" /> Connect Instagram
              </button>
            )}
          </div>
        </div>
      </section>

      {toast && (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{toast}</div>
      )}

      {reauthRequired ? (
        <div className="space-y-3 rounded-2xl border border-rose-500/40 bg-rose-950/30 px-4 py-4 text-sm text-rose-100">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Instagram access has been revoked by Meta (password change or invalidated session). Your cached posts are shown below — reconnect to resume live sync and automations.</span>
          </div>
          {syncError && <p className="text-xs text-rose-200/80">{syncError}</p>}
          <button onClick={handleConnectMeta} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black text-zinc-950">
            <Instagram className="h-4 w-4" /> Reconnect Instagram
          </button>
        </div>
      ) : syncError ? (
        <div className="flex gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{syncError}</span>
        </div>
      ) : null}

      {errorMessage === 'meta_connection_failed' && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/40 p-5 text-sm text-rose-100">
          Meta ne Page / Instagram account return nahi kiya. Facebook popup mein Instagram + Page dono tick karo, phir dubara connect.
        </div>
      )}

      {!connected ? (
        <div className="rounded-[2rem] border border-dashed border-white/15 p-12 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-fuchsia-400" />
          <p className="mt-4 font-display text-2xl text-white">Pehle account jodo</p>
          <p className="mt-2 text-sm text-zinc-400">Jodte hi yahi grid mein aapki last 50 posts aa jaayengi.</p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="aspect-[4/5] animate-pulse rounded-[1.4rem] bg-white/5" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-[2rem] border border-white/10 p-12 text-center text-sm text-zinc-400">
          Koi post sync nahi hui. Refresh posts dabao — Graph API se thumbnails aani chahiye.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onPick={setPicked} />
          ))}
        </div>
      )}

      {picked && (
        <AutomationComposer
          post={picked}
          onClose={() => setPicked(null)}
          onSaved={() => {
            setPicked(null);
            setToast('Auto-DM live. Comment aate hi flow chalega.');
            load(false);
          }}
        />
      )}
    </div>
  );
}
