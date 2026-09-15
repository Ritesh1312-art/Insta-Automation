'use client';

import { useState } from 'react';
import { Play, Sparkles, Image as ImageIcon } from 'lucide-react';
import { postCover, postTitle, type StudioPost } from '@/components/studio';

export default function PostCard({
  post,
  onPick,
  cta = 'Auto-DM lagao',
}: {
  post: StudioPost;
  onPick: (post: StudioPost) => void;
  cta?: string;
}) {
  const [broken, setBroken] = useState(false);
  const cover = postCover(post);
  const live = post.automations?.some((item) => item.status === 'ACTIVE');
  const isVideo = post.mediaType === 'REEL' || post.mediaType === 'VIDEO';

  return (
    <button
      type="button"
      onClick={() => onPick(post)}
      className="group relative aspect-[4/5] overflow-hidden rounded-[1.4rem] border border-white/10 bg-zinc-900 text-left shadow-[0_20px_50px_-28px_rgba(255,60,120,0.55)] transition duration-300 hover:-translate-y-1 hover:border-fuchsia-400/50 hover:shadow-[0_24px_60px_-20px_rgba(255,80,140,0.7)]"
    >
      {cover && !broken ? (
        <img
          src={cover}
          alt={postTitle(post)}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col justify-end bg-[radial-gradient(circle_at_top,_#fb7185,_#4c1d95_45%,_#09090b)] p-4">
          <ImageIcon className="mb-3 h-8 w-8 text-white/70" />
          <p className="line-clamp-4 text-sm font-medium text-white">{postTitle(post)}</p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent opacity-80" />

      {isVideo && (
        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur">
          <Play className="h-3 w-3 fill-white" /> Reel
        </span>
      )}
      {live && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-400 px-2 py-1 text-[10px] font-black uppercase text-emerald-950">
          Live
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 p-3">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-white drop-shadow">{postTitle(post)}</p>
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-black text-zinc-950 opacity-0 transition group-hover:opacity-100">
          <Sparkles className="h-3 w-3" /> {cta}
        </p>
      </div>
    </button>
  );
}
