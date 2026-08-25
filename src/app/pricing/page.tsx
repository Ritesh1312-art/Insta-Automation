import Link from 'next/link';
import { PLANS, PAID_PLANS } from '@/lib/plans';

export const metadata = { title: 'Pricing | InstaDM Auto' };

export default function PublicPricingPage() {
  return (
    <main className="min-h-screen bg-[#07070A] px-6 py-12 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-xs text-slate-500 hover:text-white">← Home</Link>
        <h1 className="mt-4 text-4xl font-black text-white">Pricing</h1>
        <p className="mt-2 max-w-2xl text-slate-400">
          Direct UPI. Plans stay pending until an admin matches the UTR. No unlimited tier — Instagram rate-limits DMs.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[PLANS.FREE, ...PAID_PLANS].map((plan) => (
            <article key={plan.id} className={`flex flex-col rounded-2xl border p-5 ${plan.highlighted ? 'border-fuchsia-500 bg-fuchsia-950/20' : 'border-slate-800 bg-slate-950'}`}>
              <p className="text-sm font-semibold text-fuchsia-300">{plan.name}</p>
              <p className="mt-3 text-3xl font-black">₹{plan.priceInr}</p>
              <p className="text-sm text-white">{plan.quotaLabel}</p>
              <ul className="mt-4 flex-1 space-y-2 text-xs text-slate-300">
                {plan.features.map((feature) => <li key={feature}>• {feature}</li>)}
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
      </div>
    </main>
  );
}
