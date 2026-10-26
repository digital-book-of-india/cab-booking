import { apiRequest } from './api';
import type {
  CreateTicketInput,
  SupportTicket,
  TicketMessage,
} from '../types/support.types';

export const SupportService = {
  /** List customer's support tickets */
  async listTickets(): Promise<SupportTicket[]> {
    const res = await apiRequest<SupportTicket[] | { items: SupportTicket[] }>('support/tickets');
    if (Array.isArray(res)) return res;
    if (res && 'items' in res && Array.isArray(res.items)) return res.items;
    return [];
  },

  /** Get details and chat messages of a support ticket */
  async getTicket(ticketId: string): Promise<SupportTicket> {
    return apiRequest<SupportTicket>(`support/tickets/${ticketId}`);
  },

  /** Create a new support ticket */
  async createTicket(input: CreateTicketInput): Promise<SupportTicket> {
    return apiRequest<SupportTicket>('support/tickets', {
      method: 'POST',
      body: input,
    });
  },

  /** Reply with a message in an existing support ticket */
  async reply(ticketId: string, text: string): Promise<TicketMessage> {
    return apiRequest<TicketMessage>(`support/tickets/${ticketId}/messages`, {
      method: 'POST',
      body: { text },
    });
  },

  /** Close an active support ticket */
  async closeTicket(ticketId: string): Promise<{ closed: boolean }> {
    return apiRequest<{ closed: boolean }>(`support/tickets/${ticketId}/close`, {
      method: 'POST',
    });
  },
};
