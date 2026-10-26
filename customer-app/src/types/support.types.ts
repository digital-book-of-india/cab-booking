export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_USER' | 'RESOLVED' | 'CLOSED';

export type TicketCategory =
  | 'FARE_DISPUTE'
  | 'PAYMENT_ISSUE'
  | 'DRIVER_BEHAVIOUR'
  | 'RIDER_BEHAVIOUR'
  | 'LOST_ITEM'
  | 'SAFETY_CONCERN'
  | 'APP_PROBLEM'
  | 'OTHER';

export type TicketMessage = {
  id?: string;
  senderRole?: 'CUSTOMER' | 'SUPPORT' | 'SYSTEM' | string;
  senderId?: string;
  body?: string;
  text?: string;
  message?: string;
  createdAt: string;
};

export type SupportTicket = {
  id?: string;
  ticketId?: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  bookingId?: string;
  createdAt: string;
  updatedAt?: string;
  messages: TicketMessage[];
};

export type CreateTicketInput = {
  subject: string;
  message: string;
  category: TicketCategory;
  bookingId?: string;
};
