'use client';

import { useEffect, useState } from 'react';
import { Bot, HelpCircle, RefreshCw, Settings, ShieldAlert, Webhook } from 'lucide-react';

type TelegramStatus = {
  configured: boolean;
  botTokenConfigured: boolean;
  chatId: string;
  tokenSource: 'env' | 'database' | 'missing';
  chatIdSource: 'env' | 'database' | 'missing';
  webhookUrl?: string | null;
  registeredWebhookUrl?: string | null;
  webhookMatches?: boolean | null;
  webhookLastError?: string | null;
  webhookPendingUpdates?: number | null;
  botId?: string | null;
  botUsername?: string | null;
  pairingCode?: string;
  probeError?: string | null;
};

export default function SettingsPage() {
  const [message, setMessage] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUpiId, setAdminUpiId] = useState('');
  const [adminQrCodeUrl, setAdminQrCodeUrl] = useState('');
  const [upiSaveStatus, setUpiSaveStatus] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramMessage, setTelegramMessage] = useState('');
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [metaMessage, setMetaMessage] = useState('');
  const [metaBusy, setMetaBusy] = useState(false);

  const loadTelegram = async () => {
    const response = await fetch('/api/admin/telegram-settings');
    if (!response.ok) return;
    const data = await response.json();
    setTelegramStatus(data);
    setTelegramChatId(data.chatId || '');
  };

  useEffect(() => {
    fetch('/api/auth/me').then((response) => response.json()).then((data) => {
      const admin = data.user?.role === 'ADMIN';
      setIsAdmin(admin);
      if (admin) loadTelegram().catch(() => undefined);
    }).catch(() => setIsAdmin(false));
    fetch('/api/admin/upi-settings').then((response) => response.json()).then((data) => {
      setAdminUpiId(data.adminUpiId || '');
      setAdminQrCodeUrl(data.adminQrCodeUrl || '');
    }).catch(() => undefined);
  }, []);

  const pauseAll = async () => {
    if (!confirm('Pause every active automation? No messages will be sent until you reactivate them.')) return;
    const response = await fetch('/api/automations/pause-all', { method: 'POST' });
    const data = await response.json();
    setMessage(response.ok ? `${data.paused} automation(s) paused.` : data.error || 'Unable to pause automations.');
  };

  const saveUpiSettings = async () => {
    setUpiSaveStatus('Saving…');
    try {
      const response = await fetch('/api/admin/upi-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminUpiId, adminQrCodeUrl }),
      });
      const data = await response.json();
      setUpiSaveStatus(response.ok ? '✅ UPI settings saved.' : `❌ ${data.error || 'Unable to save'}`);
    } catch { setUpiSaveStatus('❌ Unable to save UPI settings.'); }
  };

  const telegramAction = async (action: 'SAVE' | 'TEST') => {
    setTelegramBusy(true);
    setTelegramMessage(action === 'SAVE' ? 'Saving and registering webhook…' : 'Sending test…');
    try {
      const response = await fetch('/api/admin/telegram-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, botToken: telegramToken, chatId: telegramChatId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Telegram action failed');
      setTelegramStatus(data);
      setTelegramChatId(data.chatId || telegramChatId);
      setTelegramToken('');
      setTelegramMessage(`✅ ${data.message}${data.webhookError ? ` — ${data.webhookError}` : ''}`);
    } catch (error) {
      setTelegramMessage(`❌ ${error instanceof Error ? error.message : 'Telegram action failed'}`);
    } finally { setTelegramBusy(false); }
  };

  const resubscribeMeta = async () => {
    setMetaBusy(true);
    setMetaMessage('Subscribing connected Pages…');
    try {
      const response = await fetch('/api/auth/meta/debug', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Re-subscribe failed');
      const results = data.subscriptionResults || [];
      const succeeded = results.filter((item: { success: boolean }) => item.success).length;
      setMetaMessage(`✅ ${succeeded}/${results.length} connection(s) subscribed to: ${(data.subscribedFields || []).join(', ')}`);
    } catch (error) {
      setMetaMessage(`❌ ${error instanceof Error ? error.message : 'Re-subscribe failed'}`);
    } finally { setMetaBusy(false); }
  };

  const logout = async () => {
    if (!confirm('Are you sure you want to log out?')) return;
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  const inputClass = 'w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white focus:border-purple-500 focus:outline-none';

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold text-white"><Settings className="h-6 w-6 text-fuchsia-500" /> Platform Settings</h1><p className="text-sm text-slate-400">Payments, Telegram approval, Meta webhooks, and workspace controls.</p></div>

      {isAdmin && (
        <>
          <section className="space-y-4 rounded-2xl border border-purple-500/30 bg-gradient-to-br from-slate-950 to-purple-950/40 p-6">
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-white">📲 Direct UPI payment settings</h2><span className="rounded-full bg-purple-500/20 px-2.5 py-1 text-xs font-semibold text-purple-300">0% gateway fees</span></div>
            <p className="text-xs text-slate-300"><code className="text-fuchsia-300">UPI_ID</code> and <code className="text-fuchsia-300">UPI_PAYEE_NAME</code> environment values are recommended. Checkout generates an exact-amount QR automatically.</p>
            <div className="grid items-start gap-4 md:grid-cols-[1fr_auto]">
              <div className="space-y-4">
                <label className="block text-xs font-semibold text-slate-300">Admin UPI ID<input value={adminUpiId} onChange={(event) => setAdminUpiId(event.target.value)} placeholder="name@okaxis" className={`${inputClass} mt-1 font-mono`} /></label>
                <label className="block text-xs font-semibold text-slate-300">Custom QR URL (optional)<input value={adminQrCodeUrl} onChange={(event) => setAdminQrCodeUrl(event.target.value)} placeholder="Leave blank for automatic QR" className={`${inputClass} mt-1 font-mono`} /></label>
              </div>
              {adminUpiId && <div className="mx-auto h-40 w-40 rounded-2xl bg-white p-2"><img src={adminQrCodeUrl || `/api/billing/upi-qr?plan=PREMIUM&t=${encodeURIComponent(adminUpiId)}`} alt="UPI QR preview" className="h-full w-full object-contain" /></div>}
            </div>
            <div className="flex flex-wrap items-center gap-4"><button onClick={saveUpiSettings} className="rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-bold text-white">Save UPI settings</button>{upiSaveStatus && <span className="text-xs text-purple-300">{upiSaveStatus}</span>}</div>
          </section>

          <section className="space-y-4 rounded-2xl border border-sky-500/30 bg-slate-950 p-6">
            <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-bold text-white"><Bot className="h-5 w-5 text-sky-400" /> Telegram payment approval bot</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${telegramStatus?.configured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{telegramStatus?.configured ? 'Configured' : 'Not configured'}</span></div>
            <p className="text-xs leading-relaxed text-slate-300">Create a bot with BotFather, send it <code>/start</code>, then save the token and admin chat ID. New UPI submissions arrive with Approve/Reject buttons. <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code> environment values always take priority.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-300">Bot token {telegramStatus?.botTokenConfigured && <span className="font-normal text-emerald-400">({telegramStatus.tokenSource})</span>}<input type="password" value={telegramToken} onChange={(event) => setTelegramToken(event.target.value)} disabled={telegramStatus?.tokenSource === 'env'} placeholder={telegramStatus?.botTokenConfigured ? 'Stored — leave blank to keep' : '123456789:BotFatherToken'} className={`${inputClass} mt-1 font-mono disabled:opacity-50`} /></label>
              <label className="text-xs font-semibold text-slate-300">Admin chat ID {telegramStatus?.chatIdSource && <span className="font-normal text-emerald-400">({telegramStatus.chatIdSource})</span>}<input value={telegramChatId} onChange={(event) => setTelegramChatId(event.target.value)} disabled={telegramStatus?.chatIdSource === 'env'} placeholder="123456789" className={`${inputClass} mt-1 font-mono disabled:opacity-50`} /></label>
            </div>
            <div className="space-y-1 rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-400">
              {telegramStatus?.botUsername && <div>Bot: <span className="text-emerald-400">@{telegramStatus.botUsername}</span> (id {telegramStatus.botId})</div>}
              {telegramStatus?.webhookUrl && <div className="break-all">Expected webhook: {telegramStatus.webhookUrl}</div>}
              {telegramStatus?.registeredWebhookUrl !== undefined && (
                <div className="break-all">
                  Registered with Telegram:{' '}
                  <span className={telegramStatus.webhookMatches === false ? 'text-amber-300' : 'text-emerald-400'}>
                    {telegramStatus.registeredWebhookUrl || 'none'}
                  </span>
                  {telegramStatus.webhookMatches === false && ' — mismatch, press Save + register webhook'}
                </div>
              )}
              {telegramStatus?.webhookLastError && <div className="text-amber-300">Last webhook error: {telegramStatus.webhookLastError}</div>}
              {typeof telegramStatus?.webhookPendingUpdates === 'number' && telegramStatus.webhookPendingUpdates > 0 && (
                <div className="text-amber-300">Pending updates: {telegramStatus.webhookPendingUpdates}</div>
              )}
              {telegramStatus?.pairingCode && <div>Pairing command: <span className="text-sky-300">/id {telegramStatus.pairingCode}</span></div>}
              {telegramStatus?.probeError && <div className="text-amber-300">Telegram probe: {telegramStatus.probeError}</div>}
            </div>
            <div className="flex flex-wrap items-center gap-3"><button disabled={telegramBusy} onClick={() => telegramAction('SAVE')} className="rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">Save + register webhook</button><button disabled={telegramBusy || !telegramStatus?.configured} onClick={() => telegramAction('TEST')} className="rounded-xl border border-sky-500/40 px-4 py-2.5 text-xs font-bold text-sky-200 disabled:opacity-50">Send test</button>{telegramMessage && <span className="text-xs text-slate-300">{telegramMessage}</span>}</div>
          </section>

          <section className="space-y-4 rounded-2xl border border-fuchsia-500/30 bg-slate-950 p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Webhook className="h-5 w-5 text-fuchsia-400" /> Meta webhook subscription</h2>
            <p className="text-xs text-slate-300">Explicitly re-subscribe all connected Facebook Pages using the verified Page fields: <code className="text-fuchsia-300">messages, messaging_postbacks, feed</code>. This action is admin-only and never runs from a diagnostic GET.</p>
            <div className="flex flex-wrap items-center gap-3"><button disabled={metaBusy} onClick={resubscribeMeta} className="flex items-center gap-2 rounded-xl bg-fuchsia-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${metaBusy ? 'animate-spin' : ''}`} /> Re-subscribe Meta webhooks</button>{metaMessage && <span className="text-xs text-slate-300">{metaMessage}</span>}</div>
          </section>
        </>
      )}

      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-6"><h2 className="text-lg font-bold text-white">🔐 Account & session</h2><p className="text-xs text-slate-400">Sign out of the current workspace session in this browser.</p><button onClick={logout} className="rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white">Log out</button></section>

      <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-6"><h2 className="flex items-center gap-2 text-lg font-bold text-white"><HelpCircle className="h-5 w-5 text-fuchsia-400" /> Meta Developer App guide</h2><div className="space-y-3 text-xs text-slate-300"><div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-4"><h3 className="text-sm font-bold text-white">Webhook callback</h3><div className="space-y-1 rounded border border-slate-800 bg-slate-950 p-3 font-mono"><div>Callback: <span className="text-emerald-400">/api/webhooks/meta</span></div><div>Verify token: <span className="text-fuchsia-300">META_VERIFY_TOKEN</span></div><div>App dashboard fields: <span className="text-amber-300">comments, messages, messaging_postbacks</span></div></div></div><div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-4"><h3 className="text-sm font-bold text-white">Required permissions</h3><div className="flex flex-wrap gap-2 font-mono text-[11px]">{['instagram_basic', 'instagram_manage_comments', 'instagram_manage_messages', 'pages_read_engagement', 'pages_show_list'].map((permission) => <span key={permission} className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-fuchsia-300">{permission}</span>)}</div></div></div></section>

      <section className="space-y-4 rounded-2xl border border-rose-900/50 bg-rose-950/20 p-6"><h2 className="flex items-center gap-2 text-lg font-bold text-rose-300"><ShieldAlert className="h-5 w-5 text-rose-400" /> Emergency kill switch</h2><p className="text-xs text-rose-200">Immediately pauses all active automations.</p><div className="flex flex-wrap gap-3"><button onClick={pauseAll} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-medium text-white">Pause all automations</button>{message && <p className="self-center text-xs text-rose-200">{message}</p>}</div></section>
    </div>
  );
}
