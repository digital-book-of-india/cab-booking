'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { formatPaiseToInr, formatToIST } from '@/lib/currency';
import {
  ArrowLeft,
  Download,
  Printer,
  FileText,
  RefreshCw,
  X,
} from 'lucide-react';

interface InvoiceLineItem {
  bookingId: string;
  kind: string;
  at: string;
  rider?: string | null;
  from?: string | null;
  to?: string | null;
  reference?: string | null;
  amountPaise: number;
}

interface InvoiceDetail {
  invoiceId: string;
  number?: string | null;
  company?: {
    companyId: string;
    name: string;
    gstin?: string | null;
  } | null;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID';
  period: {
    from: string;
    to: string;
  };
  currency: string;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
  issuedAt?: string | null;
  dueDate?: string | null;
  lineCount?: number;
  lines?: InvoiceLineItem[];
  payments?: {
    amountPaise: number;
    reference: string;
    at: string;
  }[];
}

interface CorporateInvoiceSummary {
  invoiceId?: string;
  _id?: string;
  number?: string;
  companyName?: string;
  company?: { name?: string };
  billingMonth?: string;
  period?: { from: string; to: string };
  totalBilledPaise?: number;
  totalPaise?: number;
  subtotalPaise?: number;
  status?: string;
}

export default function CorporateInvoicesPage() {
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const printAreaRef = useRef<HTMLDivElement>(null);

  // Invoices List Query
  const { data: invoicesData, isLoading, isError, error, refetch, isFetching } = useQuery<CorporateInvoiceSummary[]>({
    queryKey: ['admin-corporate-invoices'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/admin/corporate-invoices');
        return Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data?.data?.items)
            ? res.data.data.items
            : [];
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          const res = await apiClient.get('/corporate/invoices');
          return res.data?.data || [];
        }
        throw err;
      }
    },
  });

  const invoices: CorporateInvoiceSummary[] = invoicesData || [];

  // Single Invoice Detail Query
  const {
    data: invoiceDetail,
    isLoading: isDetailLoading,
  } = useQuery<InvoiceDetail | null>({
    queryKey: ['admin-corporate-invoice-detail', selectedInvoiceId],
    queryFn: async () => {
      if (!selectedInvoiceId) return null;
      try {
        const res = await apiClient.get(`/admin/corporate-invoices/${selectedInvoiceId}`);
        return res.data?.data || res.data;
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          const res = await apiClient.get(`/corporate/invoices/${selectedInvoiceId}`);
          return res.data?.data || res.data;
        }
        return null;
      }
    },
    enabled: !!selectedInvoiceId,
  });

  // Native Print / Save as PDF handler
  const handlePrintPdf = () => {
    if (!printAreaRef.current) return;
    window.print();
  };

  // Download Standalone HTML/PDF Document
  const handleDownloadInvoiceFile = () => {
    if (!invoiceDetail || !printAreaRef.current) return;
    const invoiceHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Invoice_${invoiceDetail.number || invoiceDetail.invoiceId}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1e293b; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; }
          .title { font-size: 24px; font-weight: bold; color: #4338ca; }
          .table { width: 100%; border-collapse: collapse; margin-top: 30px; }
          .table th { background: #f8fafc; text-align: left; padding: 10px; border-bottom: 2px solid #cbd5e1; font-size: 12px; }
          .table td { padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
          .totals { margin-top: 30px; margin-left: auto; width: 300px; }
          .total-row { display: flex; justify-content: space-between; padding: 6px 0; }
          .grand-total { font-size: 16px; font-weight: bold; border-top: 2px solid #0f172a; padding-top: 10px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        ${printAreaRef.current.innerHTML}
      </body>
      </html>
    `;

    const blob = new Blob([invoiceHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Invoice_${invoiceDetail.number || invoiceDetail.invoiceId}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/corporate/accounts"
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 shadow-xs transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Corporate Monthly Invoicing Desk
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Generate, audit, and print official corporate tax invoices for post-paid enterprise accounts.
            </p>
          </div>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Invoices List Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Invoice Number / ID</th>
              <th className="px-6 py-3.5">Client Company</th>
              <th className="px-6 py-3.5">Billing Period</th>
              <th className="px-6 py-3.5">Amount Billed</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  <div className="flex items-center justify-center space-x-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                    <span>Loading corporate invoices...</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-rose-600">
                  {(error as { message?: string })?.message || 'Failed to load corporate invoices.'}
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  Zero corporate invoices generated.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => {
                const id = inv.invoiceId || inv._id || '';
                const number = inv.number || id;
                const company = inv.companyName || inv.company?.name || 'Corporate Client';
                const period = inv.billingMonth || (inv.period ? `${formatToIST(inv.period.from).slice(0, 10)} to ${formatToIST(inv.period.to).slice(0, 10)}` : 'Monthly');
                const amount = inv.totalBilledPaise || inv.totalPaise || inv.subtotalPaise || 0;

                return (
                  <tr key={id} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-4 font-mono font-bold text-indigo-700">
                      {number}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-900">
                      {company}
                    </td>
                    <td className="px-6 py-4 text-slate-500">{period}</td>
                    <td className="px-6 py-4 font-mono font-bold text-slate-900">
                      {formatPaiseToInr(amount)}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          inv.status === 'PAID'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : inv.status === 'ISSUED'
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {inv.status || 'ISSUED'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedInvoiceId(id)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-semibold transition"
                      >
                        <FileText className="h-3.5 w-3.5 inline mr-1" />
                        View / Print PDF
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Invoice Printable Document Modal */}
      {selectedInvoiceId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto print:p-0 print:bg-white">
          <div className="max-w-4xl w-full bg-white rounded-2xl shadow-2xl border border-slate-200 p-8 space-y-6 my-8 print:border-none print:shadow-none print:m-0 print:p-4">
            {/* Modal Controls (Hidden in Print) */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 print:hidden">
              <div className="flex items-center space-x-2">
                <FileText className="h-5 w-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">Tax Invoice Preview</h3>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleDownloadInvoiceFile}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download HTML</span>
                </button>
                <button
                  onClick={handlePrintPdf}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print / Save as PDF</span>
                </button>
                <button
                  onClick={() => setSelectedInvoiceId(null)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Printable Invoice Container */}
            {isDetailLoading ? (
              <div className="p-16 text-center text-slate-400 text-xs">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-600" />
                Loading verified invoice details...
              </div>
            ) : invoiceDetail ? (
              <div ref={printAreaRef} className="space-y-6 text-slate-800 text-xs print:text-black">
                {/* Invoice Header */}
                <div className="flex justify-between items-start border-b-2 border-indigo-900 pb-6">
                  <div>
                    <h2 className="text-2xl font-black text-indigo-900 tracking-tight">TAX INVOICE</h2>
                    <p className="text-slate-500 text-xs mt-1">Platform Transportation Fleet Billing</p>
                    <div className="mt-3 text-xs space-y-0.5">
                      <p className="font-bold text-slate-900">Platform Mobility Services Pvt Ltd</p>
                      <p className="text-slate-500">Connaught Place, New Delhi, India 110001</p>
                      <p className="text-slate-500">GSTIN: <span className="font-mono">07AAAAA0000A1Z5</span></p>
                    </div>
                  </div>

                  <div className="text-right space-y-1 font-mono">
                    <p className="text-base font-black text-slate-900">
                      {invoiceDetail.number || invoiceDetail.invoiceId}
                    </p>
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        invoiceDetail.status === 'PAID'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-indigo-100 text-indigo-800'
                      }`}
                    >
                      {invoiceDetail.status}
                    </span>
                    <p className="text-[11px] text-slate-500 font-sans mt-2">
                      Period: {formatToIST(invoiceDetail.period.from).slice(0, 10)} to {formatToIST(invoiceDetail.period.to).slice(0, 10)}
                    </p>
                    {invoiceDetail.dueDate && (
                      <p className="text-[11px] text-rose-600 font-sans">
                        Due Date: {formatToIST(invoiceDetail.dueDate).slice(0, 10)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Bill To */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Billed To (Corporate Client)</span>
                    <p className="font-bold text-slate-900 text-sm">
                      {invoiceDetail.company?.name || 'Corporate Account'}
                    </p>
                    <p className="text-slate-500 mt-0.5 font-mono">
                      Client ID: {invoiceDetail.company?.companyId || '-'}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Client Tax GSTIN</span>
                    <p className="font-mono font-bold text-slate-800">
                      {invoiceDetail.company?.gstin || 'Unregistered Corporate'}
                    </p>
                  </div>
                </div>

                {/* Line Items Table */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-3">#</th>
                        <th className="p-3">Date</th>
                        <th className="p-3">Booking ID</th>
                        <th className="p-3">Passenger / Ref</th>
                        <th className="p-3">Route (Origin → Destination)</th>
                        <th className="p-3 text-right">Amount (INR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoiceDetail.lines && invoiceDetail.lines.length > 0 ? (
                        invoiceDetail.lines.map((line, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="p-3 font-mono text-slate-400">{idx + 1}</td>
                            <td className="p-3 whitespace-nowrap text-slate-600">
                              {formatToIST(line.at).slice(0, 10)}
                            </td>
                            <td className="p-3 font-mono font-bold text-indigo-700">
                              {line.bookingId}
                            </td>
                            <td className="p-3 font-medium text-slate-800">
                              {line.rider || line.reference || 'Corporate Employee'}
                            </td>
                            <td className="p-3 text-slate-500 max-w-xs truncate">
                              {line.from && line.to ? `${line.from} → ${line.to}` : 'Trip Transit Mileage'}
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-slate-900">
                              {formatPaiseToInr(line.amountPaise)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-slate-400 italic">
                            Aggregated corporate ride billing cycle summary.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Financial Summary Totals */}
                <div className="flex justify-end pt-2">
                  <div className="w-72 space-y-2 text-xs border-t border-slate-200 pt-3">
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal (Fares):</span>
                      <span className="font-mono font-semibold">
                        {formatPaiseToInr(invoiceDetail.subtotalPaise)}
                      </span>
                    </div>
                    {invoiceDetail.taxPaise > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>GST Tax (Official Rate):</span>
                        <span className="font-mono font-semibold">
                          {formatPaiseToInr(invoiceDetail.taxPaise)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-900 font-bold border-t border-slate-200 pt-2 text-sm">
                      <span>Total Billed:</span>
                      <span className="font-mono text-indigo-900">
                        {formatPaiseToInr(invoiceDetail.totalPaise)}
                      </span>
                    </div>
                    <div className="flex justify-between text-emerald-700 font-medium">
                      <span>Amount Paid:</span>
                      <span className="font-mono">
                        {formatPaiseToInr(invoiceDetail.paidPaise)}
                      </span>
                    </div>
                    <div className="flex justify-between text-rose-700 font-bold border-t border-slate-100 pt-1">
                      <span>Balance Due:</span>
                      <span className="font-mono">
                        {formatPaiseToInr(invoiceDetail.duePaise)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer notes */}
                <div className="border-t border-slate-200 pt-4 text-[10px] text-slate-400 text-center">
                  <p>Computer generated invoice issued under Platform Enterprise Mobility Terms.</p>
                  <p className="mt-0.5">Please remit balance payments within authorized payment term period.</p>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-rose-600 text-xs">
                Failed to load verified invoice record.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
