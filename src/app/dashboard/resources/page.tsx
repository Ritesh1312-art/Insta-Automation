'use client';

import React, { useState, useEffect } from 'react';
import { ExternalLink, FileText, FolderDown, Plus, Link as LinkIcon, Trash2 } from 'lucide-react';

type Resource = {
  id: string;
  name: string;
  type: string;
  url?: string | null;
  textContent?: string | null;
  createdAt: string;
  _count?: { automations: number };
};

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [textContent, setTextContent] = useState('');
  const [type, setType] = useState<'URL' | 'TEXT'>('URL');
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchResources = async () => {
    setError('');
    try {
      const response = await fetch('/api/resources');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Resources load nahi ho paaye');
      setResources(data.resources || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Resources load nahi ho paaye');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchResources();
  }, []);

  const handleDeleteResource = async (resource: Resource) => {
    if (!confirm(`“${resource.name}” resource delete kar dein?`)) return;
    setDeletingId(resource.id);
    setError('');
    try {
      const response = await fetch(`/api/resources?id=${encodeURIComponent(resource.id)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Resource delete nahi ho paaya');
      setResources((current) => current.filter((item) => item.id !== resource.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Resource delete nahi ho paaya');
    } finally {
      setDeletingId('');
    }
  };

  const handleCreateResource = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, url: type === 'URL' ? url : null, textContent: type === 'TEXT' ? textContent : null }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Unable to save resource');
        return;
      }
      setShowModal(false);
      setName('');
      setUrl('');
      setTextContent('');
      await fetchResources();
    } catch {
      setError('Network error while saving the resource');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FolderDown className="w-6 h-6 text-fuchsia-500" /> Reusable Resource Library
          </h1>
          <p className="text-slate-400 text-sm">
            Save PDFs, Google Drive links, prompt packs, and presets for automated DM delivery.
          </p>
        </div>

        <button
          onClick={() => { setError(''); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl gradient-ig hover:opacity-95 text-white font-medium text-sm shadow-lg shadow-fuchsia-500/25 transition-all"
        >
          <Plus className="w-4 h-4" /> Add New Resource
        </button>
      </div>

      {error && !showModal && (
        <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>
      )}

      {loading ? (
        <div className="rounded-2xl border border-white/10 p-10 text-center text-sm text-slate-400">Resources load ho rahe hain…</div>
      ) : resources.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
          <p className="font-semibold text-white">Abhi koi saved resource nahi hai.</p>
          <p className="mt-1 text-sm text-slate-400">PDF/link ya reusable text add karke use kisi flow ke saath attach kar sakte ho.</p>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {resources.map((res) => (
          <div key={res.id} className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="p-2 rounded-lg bg-fuchsia-500/10 text-fuchsia-400">
                {res.type === 'TEXT' ? <FileText className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
              </span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400">
                {res.type}
              </span>
            </div>

            <h3 className="font-bold text-white text-base">{res.name}</h3>
            <p className="truncate font-mono text-xs text-slate-400">{res.url || res.textContent || 'No content specified'}</p>

            <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-[11px] text-slate-500">
              <span>{res._count?.automations || 0} flow mein used</span>
              <div className="flex items-center gap-2">
                {res.url && (
                  <a href={res.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fuchsia-300 hover:text-fuchsia-200">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </a>
                )}
                <button
                  type="button"
                  disabled={deletingId === res.id}
                  onClick={() => handleDeleteResource(res)}
                  className="inline-flex items-center gap-1 text-rose-300 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="resource-dialog-title" className="w-full max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="resource-dialog-title" className="text-lg font-bold text-white">Add reusable resource</h3>
              <button type="button" aria-label="Close resource editor" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateResource} className="space-y-4 text-xs">
              <div>
                <label htmlFor="resource-name" className="mb-1 block font-semibold text-slate-300">Resource name</label>
                <input
                  id="resource-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Hanuman Chalisa PDF"
                  required
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-fuchsia-500"
                />
              </div>

              <div>
                <label htmlFor="resource-type" className="mb-1 block font-semibold text-slate-300">Content type</label>
                <select id="resource-type" value={type} onChange={(event) => setType(event.target.value as 'URL' | 'TEXT')} className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100">
                  <option value="URL">Secure link / PDF URL</option>
                  <option value="TEXT">Text / prompt</option>
                </select>
              </div>

              {type === 'URL' ? (
                <div>
                  <label htmlFor="resource-url" className="mb-1 block font-semibold text-slate-300">Resource link / URL</label>
                  <input id="resource-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://your-domain.example/file.pdf" required className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-fuchsia-500 focus:outline-none" />
                </div>
              ) : (
                <div>
                  <label htmlFor="resource-text" className="mb-1 block font-semibold text-slate-300">Text or prompt</label>
                  <textarea id="resource-text" rows={5} value={textContent} onChange={(event) => setTextContent(event.target.value)} required className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-fuchsia-500 focus:outline-none" />
                </div>
              )}

              {error && <p role="alert" className="text-rose-400">{error}</p>}
              <button disabled={busy} type="submit" className="w-full rounded-xl bg-fuchsia-600 py-2.5 text-sm font-medium text-white shadow-lg shadow-fuchsia-600/30 transition-all hover:bg-fuchsia-500 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save resource'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
