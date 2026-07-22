'use client';

import React, { useState, useEffect } from 'react';
import { Zap, Plus, Check, Play, Pause, RefreshCw, Image as ImageIcon, Sparkles } from 'lucide-react';

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<any[]>([]);
  const [mediaList, setMediaList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State for New Automation
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [mediaId, setMediaId] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [keywordsText, setKeywordsText] = useState('PROMPT');
  const [customPostName, setCustomPostName] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [autoRes, mediaRes] = await Promise.all([
        fetch('/api/automations'),
        fetch('/api/media'),
      ]);

      if (autoRes.ok) setAutomations((await autoRes.json()).automations || []);
      if (mediaRes.ok) {
        const mData = await mediaRes.json();
        const mList = mData.media || [];
        setMediaList(mList);
        if (mList.length > 0 && !mediaId) setMediaId(mList[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch automations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      const res = await fetch('/api/automations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (res.ok) fetchData();
    } catch (err) {
      alert('Failed to update status');
    }
  };

  const handleCreateAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    const keywords = keywordsText
      .split('\n')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    const selectedMediaObj = mediaList.find((m) => m.id === mediaId);
    const autoName = customPostName || selectedMediaObj?.caption?.slice(0, 35) || 'Image Prompt Automation';

    const dmMessageTemplate = `Hey {{username}}! 🎁 Complete these 2 quick steps to get your prompt:\n\n👉 Step 1: Follow @stuti.ritesh90 👇\nhttps://instagram.com/stuti.ritesh90\n\n⚠️ NOTE: Follow karna compulsory hai, varna future prompt links receive nahi honge!\n\n👉 Step 2: Here is your requested Image Prompt 👇\n${promptContent}`;

    try {
      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: autoName,
          mediaId: mediaId === 'all_reels_global' ? null : mediaId,
          triggerType: 'KEYWORD',
          matchingMode: 'CONTAINS',
          keywords: keywords.length > 0 ? keywords : ['PROMPT'],
          dmMessageTemplate,
          publicReplyEnabled: true,
          publicReplyTemplates: ['Sent! Check DMs 📩', 'Done! Check your inbox 🚀'],
          status: 'ACTIVE',
        }),
      });

      if (res.ok) {
        setShowCreateModal(false);
        setPromptContent('');
        setCustomPostName('');
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create automation');
      }
    } catch (err) {
      alert('Error creating automation');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Zap className="w-6 h-6 text-fuchsia-500" /> Image Prompt Automations
          </h1>
          <p className="text-slate-400 text-sm">
            Select your Instagram Post, set your trigger keyword, and enter your prompt text.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl gradient-ig hover:opacity-95 text-white font-medium text-sm shadow-lg shadow-fuchsia-500/25 transition-all"
        >
          <Plus className="w-4 h-4" /> Create Automation
        </button>
      </div>

      {/* Automations List */}
      <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        {automations.length === 0 ? (
          <div className="text-center py-12 text-slate-500 space-y-3">
            <ImageIcon className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-sm">No automations configured yet. Click "Create Automation" to setup your first post prompt.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {automations.map((auto) => (
              <div
                key={auto.id}
                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-900/40 transition-colors"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-slate-100 text-base flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-fuchsia-400" />
                      {auto.name}
                    </h3>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        auto.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {auto.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span>
                      Target:{' '}
                      <strong className="text-slate-200">{auto.media?.caption?.slice(0, 45) || 'All Posts & Reels'}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      Trigger Word:{' '}
                      <strong className="text-fuchsia-400 uppercase font-mono">
                        {auto.keywords.join(', ') || 'PROMPT'}
                      </strong>
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 font-mono bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 w-full whitespace-pre-line">
                    {auto.dmMessageTemplate}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right hidden sm:block">
                    <div className="text-slate-200 font-semibold">{auto.totalSuccess} DMs Sent</div>
                    <div className="text-slate-500 text-[11px]">{auto.totalFailed} Failed</div>
                  </div>

                  <button
                    onClick={() => handleToggleStatus(auto.id, auto.status)}
                    className={`px-3 py-1.5 rounded-lg font-medium border flex items-center gap-1.5 ${
                      auto.status === 'ACTIVE'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                    }`}
                  >
                    {auto.status === 'ACTIVE' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {auto.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Automation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-fuchsia-500" /> Create Post Prompt Automation
                </h3>
                <p className="text-xs text-slate-400">Select your Instagram Post directly from the grid below.</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white text-lg font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAutomation} className="space-y-4 text-xs">
              {/* STEP 1: Visual Grid Post Picker */}
              <div>
                <label className="block text-slate-200 font-semibold text-sm mb-2">
                  📸 1️⃣ Select Your Instagram Post / Reel Target
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-56 overflow-y-auto pr-1 border border-slate-800 rounded-xl p-2 bg-slate-900/50">
                  {mediaList.map((m) => {
                    const isSelected = mediaId === m.id;
                    const thumbUrl = m.thumbnailUrl || m.mediaUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=300&q=80';

                    return (
                      <div
                        key={m.id}
                        onClick={() => setMediaId(m.id)}
                        className={`cursor-pointer rounded-xl p-2.5 border flex items-center gap-3 transition-all ${
                          isSelected
                            ? 'bg-fuchsia-950/40 border-fuchsia-500 shadow-md shadow-fuchsia-500/10'
                            : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <img
                          src={thumbUrl}
                          alt="Thumbnail"
                          className="w-12 h-12 rounded-lg object-cover bg-slate-800 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-200 font-medium truncate">
                            {m.caption || 'Instagram Post / Reel'}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {m.mediaType || 'REEL'}
                          </p>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-fuchsia-400 flex-shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* STEP 2: Trigger Keyword */}
              <div className="pt-2 border-t border-slate-800">
                <label className="block text-slate-300 font-semibold mb-1">2️⃣ Trigger Keyword</label>
                <input
                  type="text"
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  placeholder="PROMPT"
                  required
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-fuchsia-500"
                />
              </div>

              {/* STEP 3: Dedicated Prompt Text Box */}
              <div className="pt-2 border-t border-slate-800">
                <label className="block text-slate-200 font-semibold text-sm mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-fuchsia-400" /> 3️⃣ Enter Image Prompt For This Post
                </label>
                <textarea
                  rows={4}
                  value={promptContent}
                  onChange={(e) => setPromptContent(e.target.value)}
                  placeholder='Paste your prompt text here: e.g. "Cinematic 8K photorealistic render of Hanuman Ji, golden hour lighting, octane render, 32k resolution --ar 16:9"'
                  required
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-slate-100 font-mono focus:outline-none focus:border-fuchsia-500 text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl gradient-ig hover:opacity-95 text-white font-bold text-sm shadow-lg shadow-fuchsia-500/25 transition-all flex items-center justify-center gap-2 mt-4"
              >
                <Zap className="w-4 h-4 fill-white" /> Save & Activate Post Prompt
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
