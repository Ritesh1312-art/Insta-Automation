'use client';

import { useEffect, useState } from 'react';
import { Pause, Play, Trash2 } from 'lucide-react';
import PostCard from '@/components/PostCard';
import AutomationComposer from '@/components/AutomationComposer';
import { postCover, type StudioPost } from '@/components/studio';

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<any[]>([]);
  const [posts, setPosts] = useState<StudioPost[]>([]);
  const [picked, setPicked] = useState<StudioPost | null>(null);

  const load = async () => {
    const [autoRes, mediaRes] = await Promise.all([fetch('/api/automations'), fetch('/api/media')]);
    if (autoRes.ok) setAutomations((await autoRes.json()).automations || []);
    if (mediaRes.ok) setPosts((await mediaRes.json()).media || []);
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (id: string, status: string) => {
    await fetch('/api/automations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }),
    });
    load();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete “${name}”?`)) return;
    await fetch(`/api/automations?id=${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-fuchsia-300">Flows</p>
        <h1 className="font-display text-3xl font-black text-white">Nayi automation = post tap</h1>
        <p className="text-sm text-zinc-400">Neeche live rules. Upar se koi bhi post chuno — message wahi se lagta hai.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {posts.slice(0, 8).map((post) => (
          <PostCard key={post.id} post={post} onPick={setPicked} cta="Ispe lagao" />
        ))}
      </div>

      <div className="space-y-3">
        {automations.map((auto) => (
          <div key={auto.id} className="flex items-center gap-4 rounded-3xl border border-white/10 bg-white/5 p-3">
            <div className="h-16 w-16 overflow-hidden rounded-2xl bg-zinc-800">
              {postCover(auto.media || {}) ? (
                <img src={postCover(auto.media)} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white">{auto.name}</p>
              <p className="text-xs text-zinc-400">
                {auto.triggerType === 'ANY_COMMENT' ? 'Any comment' : auto.keywords?.join(', ')} · {auto.totalSuccess} sent
              </p>
            </div>
            <span className={`text-[10px] font-black uppercase ${auto.status === 'ACTIVE' ? 'text-emerald-400' : 'text-amber-300'}`}>{auto.status}</span>
            <button onClick={() => toggle(auto.id, auto.status)} className="rounded-full bg-white/10 p-2 text-white">
              {auto.status === 'ACTIVE' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button onClick={() => remove(auto.id, auto.name)} className="rounded-full bg-rose-500/20 p-2 text-rose-300">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {picked && (
        <AutomationComposer post={picked} onClose={() => setPicked(null)} onSaved={() => { setPicked(null); load(); }} />
      )}
    </div>
  );
}
