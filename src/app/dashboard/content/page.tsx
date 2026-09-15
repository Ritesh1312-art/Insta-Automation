'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import PostCard from '@/components/PostCard';
import AutomationComposer from '@/components/AutomationComposer';
import type { StudioPost } from '@/components/studio';

export default function ContentPage() {
  const [posts, setPosts] = useState<StudioPost[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [picked, setPicked] = useState<StudioPost | null>(null);
  const [syncError, setSyncError] = useState('');

  const load = async (sync = false) => {
    setSyncing(true);
    setSyncError('');
    try {
      const response = await fetch(`/api/media${sync ? '?sync=true' : ''}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load posts');
      setPosts(data.media || []);
      if (data.syncError) setSyncError(`Instagram sync failed, so cached posts are shown: ${data.syncError}`);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Unable to load posts');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { load(false); }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-fuchsia-300">Library</p><h1 className="font-display text-3xl font-black text-white">Your actual posts</h1><p className="text-sm text-zinc-400">Thumbnails + caption. Tap any Reel to attach the auto-DM.</p></div>
        <button onClick={() => load(true)} disabled={syncing} className="rounded-full border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-50"><RefreshCw className={`mr-2 inline h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />Sync</button>
      </div>
      {syncError && <div className="flex gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{syncError}</span></div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {posts.map((post) => <PostCard key={post.id} post={post} onPick={setPicked} />)}
      </div>
      {!posts.length && !syncing && <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-sm text-zinc-400">No cached posts yet. Use Sync to fetch them from Instagram.</div>}
      {picked && <AutomationComposer post={picked} onClose={() => setPicked(null)} onSaved={() => { setPicked(null); load(false); }} />}
    </div>
  );
}
