'use client';

import React, { useState, useEffect } from 'react';
import { FolderDown, Plus, Link as LinkIcon, FileText } from 'lucide-react';

export default function ResourcesPage() {
  const [resources, setResources] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState('URL');

  useEffect(() => {
    fetchResources();
  }, []);

  const fetchResources = async () => {
    try {
      const res = await fetch('/api/resources');
      if (res.ok) setResources((await res.json()).resources || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, url }),
      });
      if (res.ok) {
        setShowModal(false);
        setName('');
        setUrl('');
        fetchResources();
      }
    } catch (err) {
      alert('Error creating resource');
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
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl gradient-ig hover:opacity-95 text-white font-medium text-sm shadow-lg shadow-fuchsia-500/25 transition-all"
        >
          <Plus className="w-4 h-4" /> Add New Resource
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {resources.map((res) => (
          <div key={res.id} className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="p-2 rounded-lg bg-fuchsia-500/10 text-fuchsia-400">
                <LinkIcon className="w-4 h-4" />
              </span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400">
                {res.type}
              </span>
            </div>

            <h3 className="font-bold text-white text-base">{res.name}</h3>
            <p className="text-xs font-mono text-slate-400 truncate">{res.url || 'No URL specified'}</p>

            <div className="pt-2 text-[11px] text-slate-500">
              Added: {new Date(res.createdAt).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Add Downloadable Resource</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateResource} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Resource Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Hanuman Chalisa PDF"
                  required
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-fuchsia-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Resource Link / URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/file.pdf"
                  required
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-fuchsia-500"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium text-sm shadow-lg shadow-fuchsia-600/30 transition-all"
              >
                Save Resource
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
