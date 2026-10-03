import Link from 'next/link';
import { CreditCard, Users } from 'lucide-react';

const destinations = [
  {
    href: '/dashboard/admin/users',
    title: 'Admin users',
    description: 'Review user plans and workspace activity.',
    icon: Users,
  },
  {
    href: '/dashboard/admin/payments',
    title: 'Payment reviews',
    description: 'Review UPI submissions and settlement status.',
    icon: CreditCard,
  },
];

export default function AdminDashboardPage() {
  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">Choose an administrator workspace.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {destinations.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-fuchsia-400/40 hover:bg-white/[0.06]">
            <Icon className="h-6 w-6 text-fuchsia-400" />
            <h2 className="mt-4 font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
