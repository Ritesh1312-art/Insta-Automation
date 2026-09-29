'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Pause, Play, Trash2 } from 'lucide-react';
import { postCover, type StudioPost } from '@/components/studio';

type Flow = {
  id: string;
  name: string;
  status: string;
  triggerType: string;
  keywords?: string[];
  dmMessageTemplate: string;
  followGateEnabled: boolean;
  totalTriggers: number;
  totalSuccess: number;
  totalFailed: number;
  media?: StudioPost | null;
  resource?: {
    id: string;
    name: string;
    type: string;
  } | null;
};

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const response = await fetch('/api/automations');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Flows load nahi ho paaye');
      setAutomations(data.automations || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Flows load nahi ho paaye');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async (flow: Flow) => {
    setBusyId(flow.id);
    setError('');
    try {
      const response = await fetch('/api/automations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: flow.id, status: flow.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Flow update nahi ho paaya');
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Flow update nahi ho paaya');
    } finally {
      setBusyId('');
    }
  };

  const remove = async (flow: Flow) => {
    if (!confirm(`“${flow.name}” flow permanently hata dein?`)) return;
    setBusyId(flow.id);
    setError('');
    try {
      const response = await fetch(`/api/automations?id=${encodeURIComponent(flow.id)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Flow delete nahi ho paaya');
      setAutomations((current) => current.filter((item) => item.id !== flow.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Flow delete nahi ho paaya');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-fuchsia-300">Flows</p>
        <h1 className="font-display text-3xl font-black text-white">Automation wali posts</h1>
        <p className="text-sm text-zinc-400">
          Yahan sirf wahi posts aur rules hain jinpar automation lagi hui hai. Nayi automation Posts page se lagao.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-10 text-center text-sm text-zinc-400">
          Flows load ho rahe hain…
        </div>
      ) : automations.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center">
          <p className="font-semibold text-white">Abhi kisi post par automation nahi lagi hai.</p>
          <p className="mt-1 text-sm text-zinc-400">Posts page par jaakar post select karo aur flow banao.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {automations.map((flow) => {
            const cover = postCover(flow.media || {});
            const busy = busyId === flow.id;
            return (
              <article key={flow.id} className="rounded-3xl border border-white/10 bg-white/5 p-3 sm:p-4">
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-zinc-800 sm:h-24 sm:w-24">
                    {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-white">{flow.name}</p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                          {flow.media?.caption || (flow.media ? 'Instagram post' : 'All posts flow')}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${flow.status === 'ACTIVE' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-amber-300/10 text-amber-300'}`}>
                        {flow.status}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-300">
                      <span className="rounded-full bg-white/5 px-2.5 py-1">
                        {flow.triggerType === 'ANY_COMMENT' ? 'Any comment' : `Keyword: ${flow.keywords?.join(', ') || '—'}`}
                      </span>
                      <span className="rounded-full bg-white/5 px-2.5 py-1">
                        {flow.followGateEnabled ? 'Follow gate on' : 'Direct DM'}
                      </span>
                      {flow.resource && (
                        <span className="rounded-full bg-fuchsia-400/10 px-2.5 py-1 text-fuchsia-200">
                          Resource: {flow.resource.name}
                        </span>
                      )}
                    </div>

                    <p className="mt-3 line-clamp-2 text-xs text-zinc-400">DM: {flow.dmMessageTemplate}</p>
                    <p className="mt-2 text-[11px] text-zinc-500">
                      {flow.totalTriggers} triggered · {flow.totalSuccess} sent · {flow.totalFailed} failed
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-end gap-2 border-t border-white/10 pt-3">
                  {flow.media?.permalink && (
                    <a href={flow.media.permalink} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:text-white">
                      <ExternalLink className="h-3.5 w-3.5" /> Post dekho
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggle(flow)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs text-white disabled:opacity-50"
                  >
                    {flow.status === 'ACTIVE' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {flow.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(flow)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 px-3 py-2 text-xs text-rose-300 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Flow hatao
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
