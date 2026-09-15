'use client';

import { FormEvent, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { postCover, postTitle, type StudioPost } from '@/components/studio';

export default function AutomationComposer({
  post,
  onClose,
  onSaved,
}: {
  post: StudioPost;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = post.automations?.[0];
  const [keyword, setKeyword] = useState(existing?.keywords?.[0] || 'PROMPT');
  const [message, setMessage] = useState(existing?.dmMessageTemplate || '');
  const [followGate, setFollowGate] = useState(true);
  const [anyComment, setAnyComment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cover = postCover(post);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: postTitle(post).slice(0, 80),
          mediaId: post.id,
          triggerType: anyComment ? 'ANY_COMMENT' : 'KEYWORD',
          matchingMode: 'CONTAINS',
          keywords: anyComment ? [] : [keyword.trim()],
          dmMessageTemplate: message.trim() || `Hi {{username}}! Here is what you asked for.`,
          followGateEnabled: followGate,
          publicReplyEnabled: true,
          publicReplyTemplates: ['Sent in DM ✨', 'Check your inbox 💌'],
          ignoreOwnerComments: true,
          oneDeliveryPerUser: true,
          status: 'ACTIVE',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save');
        return;
      }
      onSaved();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-md sm:items-center">
      <div className="grid max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-[1.8rem] border border-white/10 bg-[#120712] shadow-2xl md:grid-cols-[0.9fr_1.1fr]">
        <div className="relative hidden min-h-[320px] md:block">
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full bg-gradient-to-br from-fuchsia-600 to-amber-400" />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black p-4 text-sm text-white">{postTitle(post)}</div>
        </div>
        <form onSubmit={submit} className="space-y-4 overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-xl font-bold text-white">Is post pe auto-DM</p>
              <p className="text-xs text-zinc-400">Comment aate hi follow-gate + resource chalega. 10 second ka kaam.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full bg-white/10 p-2 text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={anyComment} onChange={(e) => setAnyComment(e.target.checked)} />
            Har comment pe bhejo (spam risk — keyword better hai)
          </label>
          {!anyComment && (
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-fuchsia-300">Trigger word</label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-white"
                placeholder="PROMPT"
                required
              />
            </div>
          )}
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-fuchsia-300">DM message</label>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hi {{username}}! Yeh raha aapka prompt / link…"
              required
              className="mt-1 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white"
            />
          </div>
          <label className="flex items-start gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={followGate} onChange={(e) => setFollowGate(e.target.checked)} className="mt-1" />
            Pehle follow maango, phir resource do (I Followed button)
          </label>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-500 via-rose-500 to-amber-400 py-3 text-sm font-black text-zinc-950 disabled:opacity-50">
            <Sparkles className="h-4 w-4" /> {busy ? 'Saving…' : 'Save & go live'}
          </button>
        </form>
      </div>
    </div>
  );
}
