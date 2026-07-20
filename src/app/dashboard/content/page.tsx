'use client';

import React, { useState, useEffect } from 'react';
import { Film, RefreshCw, ExternalLink, Zap } from 'lucide-react';
import Link from 'next/link';

export default function ContentPage() {
  const [media, setMedia] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchMedia();
  }, []);

  const fetchMedia = async (sync = false) => {
    if (sync) setSyncing(true);
    setLoading(true);
    try {
      const res = await fetch(`/api/media${sync ? '?sync=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        setMedia(data.media || []);
      }
    } catch (err) {
      console.error('Failed to fetch media:', err);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Film className="w-6 h-6 text-fuchsia-500" /> Instagram Posts & Reels
          </h1>
          <p className="text-slate-400 text-sm">
            Cached Instagram media synced directly from Meta Graph API.
          </p>
        </div>

        <button
          onClick={() => fetchMedia(true)}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-xs border border-slate-700 transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Instagram Media'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {media.map((item) => (
          <div
            key={item.id}
            className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between hover:border-slate-700 transition-all shadow-lg"
          >
            <div>
              {item.mediaUrl && (
                <div className="h-48 bg-slate-900 relative overflow-hidden border-b border-slate-800">
                  <img
                    src={item.mediaUrl}
                    alt="Reel thumbnail"
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute top-3 left-3 px-2 py-1 bg-black/70 backdrop-blur-md rounded text-[10px] font-mono font-bold text-white uppercase">
                    {item.mediaType}
                  </span>
                </div>
              )}

              <div className="p-4 space-y-2">
                <p className="text-xs text-slate-200 line-clamp-3 font-medium">
                  {item.caption || 'No caption'}
                </p>

                <div className="text-[11px] text-slate-500 font-mono">
                  Posted: {new Date(item.timestamp).toLocaleDateString()}
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-900/50 border-t border-slate-800 flex items-center justify-between">
              {item.automations && item.automations.length > 0 ? (
                <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" /> 1 Automation Attached
                </span>
              ) : (
                <span className="text-xs text-slate-500">No automation rule</span>
              )}

              <Link
                href="/dashboard/automations"
                className="px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium transition-all"
              >
                Configure
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
