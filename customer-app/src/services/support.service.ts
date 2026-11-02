import { apiRequest } from './api';
import type {
  CreateTicketInput,
  SupportTicket,
  TicketStatus,
} from '../types/support.types';

export const SupportService = {
  /** List customer's support tickets with status filter and pagination */
  async listTickets(params?: {
    status?: TicketStatus;
    page?: number;
    limit?: number;
  }): Promise<SupportTicket[]> {
    try {
      const queryParts: string[] = [];
      if (params?.status) queryParts.push(`status=${params.status}`);
      if (params?.page) queryParts.push(`page=${params.page}`);
      if (params?.limit) queryParts.push(`limit=${params.limit}`);
      const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

      const res = await apiRequest<SupportTicket[] | { items: SupportTicket[] }>(
        `support/tickets${qs}`,
      );
      if (Array.isArray(res)) return res;
      if (res && 'items' in res && Array.isArray(res.items)) return res.items;
      return [];
    } catch (err) {
      console.warn('[SupportService.listTickets] Error fetching tickets:', err);
      return [];
    }
  },

  /** Get details and chat messages of a support ticket */
  async getTicket(ticketId: string): Promise<SupportTicket> {
    const ticket = await apiRequest<SupportTicket>(`support/tickets/${ticketId}`);
    if (ticket && (ticket.ticketId || ticket.id)) {
      return ticket;
    }
    throw new Error('Ticket not found.');
  },

  /** Create a new support ticket */
  async createTicket(input: CreateTicketInput): Promise<SupportTicket> {
    const created = await apiRequest<SupportTicket>('support/tickets', {
      method: 'POST',
      body: input,
    });
    if (created && (created.ticketId || created.id)) {
      return created;
    }
    throw new Error('Could not create ticket on server');
  },

  /** Reply with a message in an existing support ticket */
  async reply(ticketId: string, text: string): Promise<SupportTicket> {
    const updated = await apiRequest<SupportTicket>(
      `support/tickets/${ticketId}/messages`,
      {
        method: 'POST',
        body: { text },
      },
    );
    if (updated && (updated.ticketId || updated.id)) {
      return updated;
    }
    throw new Error('Invalid reply response');
  },

  /** Close an active support ticket */
  async closeTicket(ticketId: string): Promise<SupportTicket> {
    const closed = await apiRequest<SupportTicket>(
      `support/tickets/${ticketId}/close`,
      {
        method: 'POST',
      },
    );
    if (closed && (closed.ticketId || closed.id)) {
      return closed;
    }
    throw new Error('Could not close ticket on server');
  },
};
