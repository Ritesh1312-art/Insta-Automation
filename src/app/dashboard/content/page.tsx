'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import PostCard from '@/components/PostCard';
import AutomationComposer from '@/components/AutomationComposer';
import type { StudioPost } from '@/components/studio';

export default function ContentPage() {
  const [posts, setPosts] = useState<StudioPost[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [picked, setPicked] = useState<StudioPost | null>(null);

  const load = async (sync = false) => {
    setSyncing(true);
    const res = await fetch(`/api/media${sync ? '?sync=true' : ''}`);
    if (res.ok) setPosts((await res.json()).media || []);
    setSyncing(false);
  };

  useEffect(() => {
    load(false);
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-fuchsia-300">Library</p>
          <h1 className="font-display text-3xl font-black text-white">Your actual posts</h1>
          <p className="text-sm text-zinc-400">Thumbnails + caption. Tap any Reel to attach the auto-DM.</p>
        </div>
        <button onClick={() => load(true)} className="rounded-full border border-white/15 px-4 py-2 text-sm text-white">
          <RefreshCw className={`mr-2 inline h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          Sync
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} onPick={setPicked} />
        ))}
      </div>
      {picked && (
        <AutomationComposer post={picked} onClose={() => setPicked(null)} onSaved={() => { setPicked(null); load(false); }} />
      )}
    </div>
  );
}
