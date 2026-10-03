'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, RotateCcw, Save, Users } from 'lucide-react';
import { requestStudioStatsRefresh } from '@/lib/studio-refresh';

type UserRow = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  plan: string;
  monthlyDmQuota: number;
  dmsUsedThisMonth: number;
  quotaResetAt?: string | null;
  planActivatedAt?: string | null;
  subscriptionStatus: string;
  totalCommentsReceived: number;
  createdAt: string;
  _count: { automations: number; directUpiPayments: number };
};

type AnalyticsResetResponse = {
  analytics: { previous: { totalCommentsReceived: number; totalTriggers: number }; automationsReset: number };
};

const PLAN_IDS = ['FREE', 'STANDARD', 'PREMIUM', 'PREMIUM_PRO', 'PREMIUM_PRO_PLUS'];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/users', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load users');
    setUsers(data.users || []);
    setSelectedPlans(Object.fromEntries((data.users || []).map((user: UserRow) => [user.id, user.plan])));
  }, []);

  useEffect(() => {
    load().catch((error) => setError(error.message));
  }, [load]);

  const act = async (userId: string, action: 'APPLY_PLAN' | 'RESET_QUOTA') => {
    setBusy(`${userId}:${action}`);
    setError('');
    setNotice('');
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action, planId: selectedPlans[userId] }),
    });
    const data = await response.json();
    setBusy('');
    if (!response.ok) {
      setError(data.error || 'Update failed');
      return;
    }
    setNotice(action === 'APPLY_PLAN' ? 'Plan applied and quota cycle restarted.' : 'DM usage reset without extending plan expiry.');
    await load();
  };

  // Explicit, confirmed admin action only. Resets analytics counters; never
  // quota, plan, flows or their status, connections, logs, or payments.
  const resetAnalytics = async (user: UserRow) => {
    setResetTarget(null);
    setBusy(`${user.id}:RESET_ANALYTICS`);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, action: 'RESET_ANALYTICS' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Analytics reset failed');
      const { previous, automationsReset } = (data as AnalyticsResetResponse).analytics;
      setNotice(
        `Analytics reset for ${user.email}: comments received ${previous.totalCommentsReceived} → 0, `
        + `trigger counters cleared on ${automationsReset} flow(s). DM quota, plan, and flows are unchanged.`,
      );
      requestStudioStatsRefresh();
      await load();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Analytics reset failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><Users className="h-6 w-6 text-fuchsia-400" /> User management</h1>
        <p className="text-sm text-slate-400">Apply a plan, reset usage, or reset analytics. Paid plans expire 30 days after activation.</p>
      </div>
      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3 text-sm text-emerald-200">{notice}</div>}

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
        <table className="min-w-[1050px] w-full text-left text-xs text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-900 text-[11px] uppercase text-slate-400">
            <tr>
              <th className="p-4">User</th><th className="p-4">Role / status</th><th className="p-4">Usage</th>
              <th className="p-4">Cycle</th><th className="p-4">Activity</th><th className="p-4">Plan control</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {users.map((user) => (
              <tr key={user.id} className="align-top hover:bg-slate-900/40">
                <td className="p-4">
                  <p className="font-semibold text-white">{user.name || 'Unnamed user'}</p>
                  <p className="font-mono text-slate-400">{user.email}</p>
                  <p className="mt-1 text-[10px] text-slate-600">Joined {new Date(user.createdAt).toLocaleDateString('en-IN')}</p>
                </td>
                <td className="p-4"><p>{user.role}</p><p className="mt-1 text-fuchsia-300">{user.subscriptionStatus}</p></td>
                <td className="p-4">
                  <p className="font-mono text-white">{user.dmsUsedThisMonth.toLocaleString('en-IN')} / {user.monthlyDmQuota.toLocaleString('en-IN')} DMs</p>
                  <div className="mt-2 h-1.5 w-32 overflow-hidden rounded bg-slate-800"><div className="h-full bg-fuchsia-500" style={{ width: `${Math.min(100, user.monthlyDmQuota ? (user.dmsUsedThisMonth / user.monthlyDmQuota) * 100 : 0)}%` }} /></div>
                </td>
                <td className="p-4 text-slate-400">
                  <p>Activated: {user.planActivatedAt ? new Date(user.planActivatedAt).toLocaleDateString('en-IN') : '—'}</p>
                  <p>Reset: {user.quotaResetAt ? new Date(user.quotaResetAt).toLocaleDateString('en-IN') : '—'}</p>
                </td>
                <td className="p-4 text-slate-400">
                  <p>{user._count.automations} flows</p>
                  <p>{user._count.directUpiPayments} UPI submissions</p>
                  <p>{(user.totalCommentsReceived ?? 0).toLocaleString('en-IN')} comments received</p>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => setResetTarget(user)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-2.5 py-1.5 font-semibold text-rose-200 hover:bg-rose-950/50 disabled:opacity-50"
                  >
                    <BarChart3 className="h-3.5 w-3.5" /> Reset analytics
                  </button>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <select value={selectedPlans[user.id] || user.plan} onChange={(event) => setSelectedPlans((current) => ({ ...current, [user.id]: event.target.value }))} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-white">
                      {PLAN_IDS.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
                    </select>
                    <button disabled={Boolean(busy)} onClick={() => act(user.id, 'APPLY_PLAN')} title="Apply plan" className="rounded-lg bg-fuchsia-600 p-2 text-white disabled:opacity-50"><Save className="h-4 w-4" /></button>
                    <button disabled={Boolean(busy)} onClick={() => act(user.id, 'RESET_QUOTA')} title="Reset DM usage" className="rounded-lg border border-slate-700 p-2 text-slate-200 disabled:opacity-50"><RotateCcw className="h-4 w-4" /></button>
                  </div>
                  {busy.startsWith(user.id) && <p className="mt-2 text-[10px] text-fuchsia-300">Updating…</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length && !error && <p className="p-10 text-center text-slate-500">No users found.</p>}
      </div>

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onKeyDown={(event) => { if (event.key === 'Escape') setResetTarget(null); }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="reset-analytics-title" aria-describedby="reset-analytics-description" className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-950 p-6 text-sm text-slate-300 shadow-2xl">
            <h2 id="reset-analytics-title" className="text-lg font-bold text-white">Reset analytics for {resetTarget.email}?</h2>
            <div id="reset-analytics-description" className="mt-3 space-y-3">
              <p className="text-rose-200">This permanently sets these counters to zero and cannot be undone:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Comments received ({(resetTarget.totalCommentsReceived ?? 0).toLocaleString('en-IN')} → 0)</li>
                <li>Trigger, success, and failure counts and last-triggered time on all of this user’s flows</li>
              </ul>
              <p className="text-slate-400">DM quota usage, plan and subscription, flows and their ACTIVE/PAUSED status, Instagram connection, posts, resources, execution logs, and payments are not changed.</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setResetTarget(null)} className="rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-200">Cancel</button>
              <button type="button" onClick={() => resetAnalytics(resetTarget)} className="rounded-lg bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-500">Reset analytics</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
