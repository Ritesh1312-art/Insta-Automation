'use client';

import React, { useState, useEffect } from 'react';
import { Zap, Plus, Check, Play, Pause, Trash2, Radio, Instagram } from 'lucide-react';

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<any[]>([]);
  const [mediaList, setMediaList] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State for New Automation
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [mediaId, setMediaId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [triggerType, setTriggerType] = useState<'KEYWORD' | 'ANY_COMMENT'>('KEYWORD');
  const [matchingMode, setMatchingMode] = useState<'EXACT' | 'CONTAINS' | 'STARTS_WITH'>('EXACT');
  const [keywordsText, setKeywordsText] = useState('HANUMAN');
  const [dmMessageTemplate, setDmMessageTemplate] = useState('Here is your requested link: {{resource_url}}');
  const [publicReplyEnabled, setPublicReplyEnabled] = useState(true);
  const [publicReplyTemplates, setPublicReplyTemplates] = useState('Sent! Check DMs 📩\nDone! Check your inbox 🚀');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [autoRes, mediaRes, resRes] = await Promise.all([
        fetch('/api/automations'),
        fetch('/api/media'),
        fetch('/api/resources'),
      ]);

      if (autoRes.ok) setAutomations((await autoRes.json()).automations || []);
      if (mediaRes.ok) {
        const mData = await mediaRes.json();
        setMediaList(mData.media || []);
        if (mData.media?.length > 0) setMediaId(mData.media[0].id);
      }
      if (resRes.ok) {
        const rData = await resRes.json();
        setResources(rData.resources || []);
        if (rData.resources?.length > 0) setResourceId(rData.resources[0].id);
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

    const publicReplies = publicReplyTemplates
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    try {
      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'New Reel Automation',
          mediaId,
          resourceId,
          triggerType,
          matchingMode,
          keywords,
          dmMessageTemplate,
          publicReplyEnabled,
          publicReplyTemplates: publicReplies,
          status: 'ACTIVE',
        }),
      });

      if (res.ok) {
        setShowCreateModal(false);
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
            <Zap className="w-6 h-6 text-fuchsia-500" /> Automation Rules Engine
          </h1>
          <p className="text-slate-400 text-sm">
            Map specific Reels/Posts to keyword triggers and private reply content.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl gradient-ig hover:opacity-95 text-white font-medium text-sm shadow-lg shadow-fuchsia-500/25 transition-all"
        >
          <Plus className="w-4 h-4" /> Create Automation
        </button>
      </div>

      {/* Automations Table / Cards */}
      <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
        {automations.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            No automations configured yet. Click "Create Automation" to setup your first rule.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {automations.map((auto) => (
              <div
                key={auto.id}
                className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-900/40 transition-colors"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-slate-100 text-base">{auto.name}</h3>
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
                      Reel ID: <strong className="text-slate-300">{auto.media?.instagramMediaId || 'Global'}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      Trigger:{' '}
                      <strong className="text-fuchsia-400 uppercase font-mono">
                        {auto.triggerType === 'ANY_COMMENT' ? 'ANY COMMENT' : auto.keywords.join(', ')}
                      </strong>
                    </span>
                    <span>•</span>
                    <span>
                      Resource: <strong className="text-slate-300">{auto.resource?.name || 'Link'}</strong>
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 font-mono bg-slate-900 px-3 py-1.5 rounded border border-slate-800 w-fit">
                    DM Preview: "{auto.dmMessageTemplate}"
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right hidden sm:block">
                    <div className="text-slate-200 font-semibold">{auto.totalSuccess} Deliveries</div>
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Create New Reel Automation</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAutomation} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Automation Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Hanuman Chalisa PDF DM"
                  required
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-fuchsia-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Select Instagram Reel / Post</label>
                <select
                  value={mediaId}
                  onChange={(e) => setMediaId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-fuchsia-500"
                >
                  {mediaList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.caption?.slice(0, 50) || m.instagramMediaId}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Trigger Mode</label>
                  <select
                    value={triggerType}
                    onChange={(e: any) => setTriggerType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-fuchsia-500"
                  >
                    <option value="KEYWORD">SPECIFIC KEYWORD</option>
                    <option value="ANY_COMMENT">ANY COMMENT</option>
                  </select>
                </div>

                {triggerType === 'KEYWORD' && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Keyword Match Mode</label>
                    <select
                      value={matchingMode}
                      onChange={(e: any) => setMatchingMode(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-fuchsia-500"
                    >
                      <option value="EXACT">EXACT MATCH</option>
                      <option value="CONTAINS">CONTAINS</option>
                      <option value="STARTS_WITH">STARTS WITH</option>
                    </select>
                  </div>
                )}
              </div>

              {triggerType === 'KEYWORD' && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Keywords (One per line)</label>
                  <textarea
                    rows={2}
                    value={keywordsText}
                    onChange={(e) => setKeywordsText(e.target.value)}
                    placeholder="HANUMAN&#10;PDF&#10;LINK"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-fuchsia-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Select Attached Resource</label>
                <select
                  value={resourceId}
                  onChange={(e) => setResourceId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-fuchsia-500"
                >
                  {resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.url || r.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Private Reply DM Message Template
                </label>
                <textarea
                  rows={3}
                  value={dmMessageTemplate}
                  onChange={(e) => setDmMessageTemplate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-fuchsia-500"
                />
                <span className="text-[10px] text-slate-500">
                  Variables available: &#123;&#123;username&#125;&#125;, &#123;&#123;resource_url&#125;&#125;, &#123;&#123;comment_text&#125;&#125;
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium text-sm shadow-lg shadow-fuchsia-600/30 transition-all"
                >
                  Save & Activate Automation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
