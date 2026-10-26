'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { SupportTicket } from '@/types';
import { formatToIST } from '@/lib/currency';
import { Send } from 'lucide-react';

export default function SupportTicketsPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [sending, setSending] = useState(false);

  const fetchTickets = async () => {
    try {
      const res = await apiClient.get('/support/tickets');
      setTickets(res.data.data);
      if (res.data.data.length > 0 && !activeTicket) {
        setActiveTicket(res.data.data[0]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !replyMessage.trim()) return;
    setSending(true);

    try {
      await apiClient.post(`/support/tickets/${activeTicket.ticketId}/messages`, {
        message: replyMessage,
      });
      setReplyMessage('');
      fetchTickets();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Support Desk Workspace</h1>
        <p className="text-xs text-slate-500 mt-1">Audit customer dispute inquiries, vehicle condition reports, and reply in threads.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[550px]">
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 overflow-y-auto shadow-xs">
          {loading ? (
            <div className="text-slate-400 text-xs p-4">Loading open inquiries...</div>
          ) : (
            tickets.map((t) => (
              <div
                key={t.ticketId}
                onClick={() => setActiveTicket(t)}
                className={`p-3 rounded-lg border cursor-pointer transition ${
                  activeTicket?.ticketId === t.ticketId
                    ? 'border-indigo-600 bg-indigo-50/70 shadow-xs'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex justify-between items-center text-xs">
                  <span className="font-mono text-indigo-700 font-bold">{t.ticketId}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">{t.status}</span>
                </div>
                <h4 className="text-xs font-semibold text-slate-900 mt-1 truncate">{t.subject}</h4>
                <p className="text-[11px] text-slate-500 mt-0.5">{t.customerName} • {t.category}</p>
              </div>
            ))
          )}
        </div>

        <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white flex flex-col overflow-hidden shadow-xs">
          {activeTicket ? (
            <>
              <div className="p-4 border-b border-slate-200 bg-slate-50">
                <h3 className="font-bold text-slate-900 text-sm">{activeTicket.subject}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  User: <span className="font-semibold text-slate-700">{activeTicket.customerName}</span> ({activeTicket.customerPhoneMasked}) • Category: <span className="text-indigo-600 font-medium">{activeTicket.category}</span>
                </p>
              </div>

              <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs bg-slate-50/40">
                {activeTicket.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`p-3 rounded-xl max-w-md shadow-xs ${
                      m.sender === 'CUSTOMER'
                        ? 'bg-white border border-slate-200 text-slate-800 self-start'
                        : 'bg-indigo-600 text-white ml-auto'
                    }`}
                  >
                    <p className="text-[10px] opacity-80 font-semibold mb-1">{m.senderName} • {formatToIST(m.timestamp)}</p>
                    <p className="leading-relaxed">{m.message}</p>
                  </div>
                ))}
              </div>

              <form onSubmit={handleSendReply} className="p-3 border-t border-slate-200 bg-white flex space-x-2">
                <input
                  type="text"
                  placeholder="Type official support message to user..."
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                />
                <button
                  type="submit"
                  disabled={sending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
              Select an inquiry to view threaded conversation.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}