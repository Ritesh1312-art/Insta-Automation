import Link from 'next/link';
import { PLANS, PAID_PLANS } from '@/lib/plans';

const steps = [
  { title: 'Comment matches a keyword', body: 'A signed Meta comments webhook starts the run. One private reply is allowed per comment.' },
  { title: 'Follow CTA is sent', body: 'The first DM asks the person to follow your public profile. Instagram does not send a follow webhook.' },
  { title: 'They tap I Followed', body: 'Honor-system confirm (or reply DONE). We mark the contact claimed and send the unlock card.' },
  { title: 'Resource is delivered', body: 'The final button sends your prompt, link, or file URL inside the 24-hour messaging window.' },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#07070A] text-slate-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-extrabold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl gradient-ig text-white">⚡</span>
          InstaDM Auto
        </div>
        <nav className="flex items-center gap-4 text-sm text-slate-300">
          <Link href="/pricing" className="hover:text-white">Pricing</Link>
          <Link href="/policies" className="hover:text-white">Policies</Link>
          <Link href="/login" className="hover:text-white">Sign in</Link>
          <Link href="/register" className="rounded-full bg-fuchsia-600 px-4 py-2 font-semibold text-white">Create account</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-10">
        <p className="mb-4 inline-flex rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-fuchsia-300">
          Official Meta Graph API · no unofficial scrapers
        </p>
        <h1 className="font-display max-w-3xl text-4xl font-black leading-[0.95] text-white md:text-7xl">
          Tap the Reel.
          <span className="block bg-gradient-to-r from-fuchsia-400 via-rose-400 to-amber-300 bg-clip-text text-transparent"> Drop the DM.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-zinc-400">
          Connect Instagram and your real posts show up as a studio wall — not a name list. One tap attaches the follow-gate auto-DM.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/register" className="rounded-xl gradient-ig px-6 py-3 text-sm font-bold text-white shadow-lg shadow-fuchsia-600/30">
            Start with 30 free DMs
          </Link>
          <Link href="/#pricing" className="rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-white">
            View plans
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 md:grid-cols-4">
        {steps.map((step, index) => (
          <article key={step.title} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5">
            <p className="text-xs font-mono text-fuchsia-400">0{index + 1}</p>
            <h2 className="mt-2 font-bold text-white">{step.title}</h2>
            <p className="mt-2 text-sm text-slate-400">{step.body}</p>
          </article>
        ))}
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-black text-white">Simple UPI pricing</h2>
          <p className="mt-2 text-slate-400">No “unlimited” tier. Instagram rate-limits DMs. Quotas are monthly hard caps.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[PLANS.FREE, ...PAID_PLANS].map((plan) => (
            <article
              key={plan.id}
              className={`flex flex-col rounded-2xl border p-5 ${plan.highlighted ? 'border-fuchsia-500 bg-fuchsia-950/20' : 'border-slate-800 bg-slate-950'}`}
            >
              <p className="text-sm font-semibold text-fuchsia-300">{plan.name}</p>
              <p className="mt-3 text-3xl font-black text-white">₹{plan.priceInr}</p>
              <p className="text-xs text-slate-500">/ 30 days</p>
              <p className="mt-2 text-sm font-medium text-white">{plan.quotaLabel}</p>
              <ul className="mt-4 flex-1 space-y-2 text-xs text-slate-300">
                {plan.features.map((feature) => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>
              <Link
                href={plan.id === 'FREE' ? '/register' : `/verify?plan=${plan.id}`}
                className={`mt-6 rounded-xl py-2.5 text-center text-sm font-bold ${plan.highlighted ? 'bg-fuchsia-600 text-white' : 'bg-slate-800 text-white'}`}
              >
                {plan.cta}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-3xl border border-amber-700/40 bg-amber-950/20 p-8">
          <h2 className="text-2xl font-bold text-amber-200">Account-ban risk is real</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-amber-100/80">
            Meta can restrict professional accounts that send unsolicited DMs, repeat the same template too often, or try to detect follows in ways the API does not support.
            This product uses official private replies and honor-system follow confirms. It cannot guarantee deliverability or account safety. Read the full policy notes before you scale.
          </p>
          <Link href="/policies" className="mt-4 inline-block text-sm font-semibold text-amber-200 underline">
            Read Instagram policy notes →
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-900 px-6 py-8 text-center text-xs text-slate-500">
        <Link href="/privacy" className="mx-2 hover:text-slate-300">Privacy</Link>
        <Link href="/terms" className="mx-2 hover:text-slate-300">Terms</Link>
        <Link href="/policies" className="mx-2 hover:text-slate-300">Policies</Link>
        <Link href="/data-deletion" className="mx-2 hover:text-slate-300">Data deletion</Link>
      </footer>
    </main>
  );
}
