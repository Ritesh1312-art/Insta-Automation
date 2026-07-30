import { PrismaClient } from '@prisma/client';
import { CreditCard, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

const prisma = new PrismaClient();

export default async function AdminPaymentsPage() {
  const payments = await prisma.directUpiPayment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const totalRevenue = payments.reduce((acc, curr) => acc + curr.amount, 0);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-purple-400" /> Direct UPI Payments & UTR Audit Log
          </h1>
          <p className="text-slate-400 text-sm">
            Review all 12-digit UTR payment submissions received directly in your bank account.
          </p>
        </div>
        <div className="bg-purple-950/60 border border-purple-800/60 rounded-2xl px-5 py-3 text-right">
          <span className="text-xs text-slate-400 uppercase font-semibold">Total Revenue Collected</span>
          <p className="text-2xl font-extrabold text-purple-300">₹{totalRevenue.toLocaleString()}</p>
        </div>
      </div>

      {/* Payments Table */}
      <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> Recent UPI UTR Submissions ({payments.length})
          </h3>
          <span className="text-xs text-slate-400">0% Gateway Transaction Fees</span>
        </div>

        {payments.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            No UTR payment submissions recorded yet. Payments will appear here as users subscribe via Direct UPI.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900 text-slate-400 uppercase font-mono text-[11px] border-b border-slate-800">
                <tr>
                  <th className="p-4">Customer Email</th>
                  <th className="p-4">Plan Activated</th>
                  <th className="p-4">Amount Paid</th>
                  <th className="p-4">12-Digit UTR Number</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Date & Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {payments.map((pay) => (
                  <tr key={pay.id} className="hover:bg-slate-900/40 transition">
                    <td className="p-4 text-white font-semibold">{pay.userEmail}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        pay.planType === 'VIP_UNLIMITED'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      }`}>
                        {pay.planType}
                      </span>
                    </td>
                    <td className="p-4 font-bold text-emerald-400">₹{pay.amount}</td>
                    <td className="p-4 font-extrabold text-purple-300 tracking-wider">
                      {pay.utrNumber}
                    </td>
                    <td className="p-4">
                      <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> VERIFIED & ACTIVE
                      </span>
                    </td>
                    <td className="p-4 text-slate-400 text-[11px]">
                      {new Date(pay.createdAt).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
