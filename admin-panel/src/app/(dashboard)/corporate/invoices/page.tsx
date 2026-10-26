'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { CorporateInvoice } from '@/types';
import { formatPaiseToInr } from '@/lib/currency';
import { ArrowLeft, Download } from 'lucide-react';

export default function CorporateInvoicesPage() {
  const [invoices, setInvoices] = useState<CorporateInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/corporate/invoices').then((res) => {
      setInvoices(res.data.data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Link href="/corporate/accounts" className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 shadow-xs">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Corporate Monthly Invoicing Desk</h1>
          <p className="text-xs text-slate-500 mt-0.5">Automated tax invoices generated for post-paid corporate accounts.</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Invoice Number</th>
              <th className="px-6 py-3.5">Client Company</th>
              <th className="px-6 py-3.5">Billing Cycle</th>
              <th className="px-6 py-3.5">Total Rides</th>
              <th className="px-6 py-3.5">Amount Billed</th>
              <th className="px-6 py-3.5 text-right">PDF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Loading invoices...</td></tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.invoiceId} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4 font-mono font-bold text-indigo-700 text-xs">{inv.invoiceId}</td>
                  <td className="px-6 py-4 text-xs font-medium text-slate-900">{inv.companyName}</td>
                  <td className="px-6 py-4 text-xs text-slate-500">{inv.billingMonth}</td>
                  <td className="px-6 py-4 text-xs font-semibold text-slate-700">{inv.totalRides} Trips</td>
                  <td className="px-6 py-4 font-mono font-bold text-slate-900 text-xs">{formatPaiseToInr(inv.totalBilledPaise)}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => alert(`Downloading Invoice PDF: ${inv.invoiceId}`)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition"
                    >
                      <Download className="h-3.5 w-3.5 inline mr-1" />
                      PDF
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}