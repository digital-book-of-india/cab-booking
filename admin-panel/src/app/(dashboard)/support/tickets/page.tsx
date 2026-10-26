'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { formatToIST } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import {
  Send,
  RefreshCw,
  Search,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from 'lucide-react';


interface SupportMessage {
  sender?: string;
  byRole?: string;
  at?: string;
  text?: string;
  id?: string;
  senderId?: string;
  senderRole?: string;
  senderName?: string;
  message: string;
  internal?: boolean;
  createdAt: string;
}

interface SupportTicket {
  customerName?: string;
  id: string;
  ticketId?: string;
  referenceNumber?: string;
  subject?: string;
  category: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'ASSIGNED' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  creatorName?: string;
  creatorRole?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt?: string;
  messages?: SupportMessage[];
}

const TICKET_CATEGORIES = [
  'FARE_DISPUTE',
  'PAYMENT_ISSUE',
  'DRIVER_BEHAVIOUR',
  'RIDER_BEHAVIOUR',
  'LOST_ITEM',
  'SAFETY_CONCERN',
  'APP_PROBLEM',
  'OTHER',
];

const RESOLUTION_OUTCOMES = [
  'REFUNDED',
  'FEE_WAIVED',
  'WARNING_ISSUED',
  'NO_ACTION',
  'ESCALATED',
  'OTHER',
];

export default function SupportTicketsPage() {
  const queryClient = useQueryClient();

  // Filters & State
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Chat message & Internal toggle
  const [replyMessage, setReplyMessage] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);

  // Resolution modal
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveOutcome, setResolveOutcome] = useState(RESOLUTION_OUTCOMES[0]);
  const [resolveNote, setResolveNote] = useState('');

  // Feedback Banner
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Tickets List Query
  const { data: ticketsData, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: [
      'admin-support-tickets',
      { status: statusFilter, category: categoryFilter, priority: priorityFilter, q: searchQuery, page },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (categoryFilter) params.append('category', categoryFilter);
      if (priorityFilter) params.append('priority', priorityFilter);
      if (searchQuery) params.append('q', searchQuery.trim());
      params.append('page', String(page));
      params.append('limit', String(limit));

      try {
        const res = await apiClient.get(`/admin/support/tickets?${params.toString()}`);
        return res.data?.data || res.data;
      } catch (err: unknown) {
        // Fallback for user tickets if admin path is 404
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          const res = await apiClient.get(`/support/tickets?${params.toString()}`);
          return res.data?.data || res.data;
        }
        throw err;
      }
    },
  });

  const tickets: SupportTicket[] = Array.isArray(ticketsData)
    ? ticketsData
    : Array.isArray(ticketsData?.items)
      ? ticketsData.items
      : [];
  
  // Single Ticket Detail Query
  const { data: activeTicketData, refetch: refetchTicket } = useQuery({
    queryKey: ['admin-support-ticket-detail', selectedTicketId],
    queryFn: async () => {
      if (!selectedTicketId) return null;
      try {
        const res = await apiClient.get(`/admin/support/tickets/${selectedTicketId}`);
        return res.data?.data || res.data;
      } catch (err: unknown) {
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          const res = await apiClient.get(`/support/tickets/${selectedTicketId}`);
          return res.data?.data || res.data;
        }
        return null;
      }
    },
    enabled: !!selectedTicketId,
  });

  const activeTicket = activeTicketData || tickets.find((t) => (t.ticketId || t.id) === selectedTicketId);

  // Auto-select first ticket
  if (!selectedTicketId && tickets.length > 0) {
    setSelectedTicketId(tickets[0].ticketId || tickets[0].id);
  }

  // Send Message Mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({
      ticketId,
      text,
      internal,
    }: {
      ticketId: string;
      text: string;
      internal: boolean;
    }) => {
      try {
        const res = await apiClient.post(`/admin/support/tickets/${ticketId}/messages`, {
          text,
          internal,
        });
        return res.data;
      } catch (err: unknown) {
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          const res = await apiClient.post(`/support/tickets/${ticketId}/messages`, {
            text,
          });
          return res.data;
        }
        throw err;
      }
    },
    onSuccess: () => {
      setReplyMessage('');
      refetchTicket();
      queryClient.invalidateQueries({ queryKey: ['admin-support-tickets'] });
    },
    onError: (err: unknown) => {
      setFeedback({ type: 'error', message: getErrorMessage(err) || 'Failed to send message.' });
    },
  });

  // Update Status / Priority Mutation
  const updateTicketMutation = useMutation({
    mutationFn: async ({
      ticketId,
      status,
      priority,
    }: {
      ticketId: string;
      status?: string;
      priority?: string;
    }) => {
      const res = await apiClient.patch(`/admin/support/tickets/${ticketId}`, {
        status,
        priority,
      });
      return res.data;
    },
    onSuccess: () => {
      refetchTicket();
      queryClient.invalidateQueries({ queryKey: ['admin-support-tickets'] });
      setFeedback({ type: 'success', message: 'Ticket status successfully updated.' });
    },
    onError: (err: unknown) => {
      setFeedback({ type: 'error', message: getErrorMessage(err) || 'Failed to update ticket.' });
    },
  });

  // Resolve Ticket Mutation
  const resolveTicketMutation = useMutation({
    mutationFn: async ({
      ticketId,
      outcome,
      note,
    }: {
      ticketId: string;
      outcome: string;
      note: string;
    }) => {
      const res = await apiClient.post(`/admin/support/tickets/${ticketId}/resolve`, {
        outcome,
        note,
      });
      return res.data;
    },
    onSuccess: () => {
      setShowResolveModal(false);
      setResolveNote('');
      refetchTicket();
      queryClient.invalidateQueries({ queryKey: ['admin-support-tickets'] });
      setFeedback({ type: 'success', message: 'Ticket successfully resolved.' });
    },
    onError: (err: unknown) => {
      setFeedback({ type: 'error', message: getErrorMessage(err) || 'Failed to resolve ticket.' });
    },
  });

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !replyMessage.trim() || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate({
      ticketId: activeTicket.ticketId || activeTicket.id,
      text: replyMessage.trim(),
      internal: isInternalNote,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Support Desk Workspace
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Audit customer dispute inquiries, vehicle condition reports, internal notes, and resolution actions.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 font-bold ml-4">
            ✕
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs text-xs">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search tickets..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-600"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
        >
          <option value="">All Categories</option>
          {TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
        >
          <option value="">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="WAITING_USER">Waiting User</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => {
            setPriorityFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
        >
          <option value="">All Priorities</option>
          <option value="HIGH">High Priority</option>
          <option value="NORMAL">Normal Priority</option>
          <option value="LOW">Low Priority</option>
        </select>
      </div>

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[580px]">
        {/* Ticket List Queue */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 overflow-y-auto shadow-xs">
          {isLoading ? (
            <div className="text-slate-400 text-xs p-6 text-center">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2 text-indigo-600" />
              Loading open inquiries...
            </div>
          ) : isError ? (
            <div className="text-rose-600 text-xs p-4 text-center">
              Failed to load support tickets. {getErrorMessage(error)}
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-slate-400 text-xs p-6 text-center">
              Zero support inquiries matching filter.
            </div>
          ) : (
            tickets.map((t: SupportTicket) => {
              const id = t.ticketId || t.id;
              const isSelected = (activeTicket?.ticketId || activeTicket?.id) === id;
              return (
                <div
                  key={id}
                  onClick={() => setSelectedTicketId(id)}
                  className={`p-3 rounded-lg border cursor-pointer transition ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/70 shadow-xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-mono text-indigo-700 font-bold">#{id}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        t.priority === 'HIGH'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                  <h4 className="text-xs font-semibold text-slate-900 mt-1 truncate">
                    {t.subject || t.category}
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {t.customerName || 'Customer'} • <span className="text-indigo-600">{t.category}</span>
                  </p>
                </div>
              );
            })
          )}
        </div>

        {/* Threaded Chat Workspace */}
        <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white flex flex-col overflow-hidden shadow-xs">
          {activeTicket ? (
            <>
              {/* Ticket Top Action Bar */}
              <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    {activeTicket.subject || activeTicket.category}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    User: <span className="font-semibold text-slate-700">{activeTicket.customerName || 'User'}</span> ({activeTicket.customerPhoneMasked || '+91 ••••• •••••'}) • Category: <span className="text-indigo-600 font-medium">{activeTicket.category}</span>
                  </p>
                </div>

                <div className="flex items-center space-x-2 text-xs">
                  {activeTicket.status !== 'RESOLVED' && activeTicket.status !== 'CLOSED' && (
                    <button
                      onClick={() => setShowResolveModal(true)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition"
                    >
                      Resolve Ticket
                    </button>
                  )}
                  <select
                    value={activeTicket.status}
                    onChange={(e) =>
                      updateTicketMutation.mutate({
                        ticketId: activeTicket.ticketId || activeTicket.id,
                        status: e.target.value,
                      })
                    }
                    className="px-2 py-1 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700"
                  >
                    <option value="OPEN">Open</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="WAITING_USER">Waiting User</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </div>
              </div>

              {/* Messages Thread */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs bg-slate-50/50">
                {(activeTicket.messages || []).map((m: SupportMessage, idx: number) => {
                  const isStaff = m.sender === 'STAFF' || m.sender === 'AGENT' || m.byRole === 'STAFF';
                  const isInternal = m.internal === true;

                  return (
                    <div
                      key={m.id || idx}
                      className={`p-3 rounded-xl max-w-lg shadow-xs space-y-1 ${
                        isInternal
                          ? 'bg-amber-50 border border-amber-200 text-amber-900 ml-auto'
                          : isStaff
                            ? 'bg-indigo-600 text-white ml-auto'
                            : 'bg-white border border-slate-200 text-slate-800 self-start'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] opacity-80 border-b border-black/10 pb-1 mb-1">
                        <span className="font-semibold flex items-center space-x-1">
                          {isInternal && <Lock className="h-2.5 w-2.5 inline mr-0.5" />}
                          <span>{isInternal ? 'INTERNAL NOTE' : isStaff ? 'Support Staff' : 'Customer'}</span>
                        </span>
                        <span>{formatToIST(m.createdAt || m.at || '')}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.text || m.message}</p>
                    </div>
                  );
                })}
              </div>

              {/* Reply Form */}
              <form onSubmit={handleSendReply} className="p-3 border-t border-slate-200 bg-white space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center space-x-1.5 cursor-pointer text-slate-600">
                    <input
                      type="checkbox"
                      checked={isInternalNote}
                      onChange={(e) => setIsInternalNote(e.target.checked)}
                      className="rounded text-amber-600"
                    />
                    <Lock className="h-3 w-3 text-amber-600" />
                    <span className="font-semibold text-slate-700">Internal Note (Staff Only)</span>
                  </label>
                  <span className="text-[11px] text-slate-400">
                    {isInternalNote ? 'Hidden from customer' : 'Customer will receive this message'}
                  </span>
                </div>

                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    placeholder={
                      isInternalNote
                        ? 'Write internal operational note...'
                        : 'Write reply to customer...'
                    }
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  <button
                    type="submit"
                    disabled={sendMessageMutation.isPending || !replyMessage.trim()}
                    className={`flex items-center space-x-1 px-4 py-2 rounded-lg font-semibold text-xs text-white transition disabled:opacity-50 ${
                      isInternalNote ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>{isInternalNote ? 'Log Note' : 'Reply'}</span>
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-400 text-xs">
              <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
              <span>Select an inquiry from the queue to start conversation</span>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Resolve Ticket */}
      {showResolveModal && activeTicket && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Resolve Support Ticket</h3>
            <p className="text-slate-500">
              Select resolution outcome and document notes sent to the user.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                resolveTicketMutation.mutate({
                  ticketId: activeTicket.ticketId || activeTicket.id,
                  outcome: resolveOutcome,
                  note: resolveNote,
                });
              }}
              className="space-y-3"
            >
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Resolution Outcome *
                </label>
                <select
                  value={resolveOutcome}
                  onChange={(e) => setResolveOutcome(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                >
                  {RESOLUTION_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Resolution Note (Customer Facing) *
                </label>
                <textarea
                  rows={3}
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  placeholder="e.g. We investigated the GPS route and verified fare quote."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowResolveModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resolveTicketMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
                >
                  {resolveTicketMutation.isPending ? 'Resolving...' : 'Confirm Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
