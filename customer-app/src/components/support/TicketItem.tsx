import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { SupportTicket, TicketStatus } from '../../types/support.types';
import { Badge, type BadgeVariant } from '../common/Badge';
import { styles } from './TicketItem.styles';

export type TicketItemProps = {
  ticket: SupportTicket;
  onPress: (ticket: SupportTicket) => void;
};

const getStatusBadge = (status: TicketStatus): { label: string; variant: BadgeVariant } => {
  switch (status) {
    case 'OPEN':
      return { label: 'Open', variant: 'warning' };
    case 'IN_PROGRESS':
    case 'WAITING_USER':
      return { label: 'In Progress', variant: 'info' };
    case 'RESOLVED':
      return { label: 'Resolved', variant: 'success' };
    case 'CLOSED':
    default:
      return { label: 'Closed', variant: 'neutral' };
  }
};

export const TicketItem: React.FC<TicketItemProps> = ({ ticket, onPress }) => {
  const badge = getStatusBadge(ticket.status);
  const formattedDate = new Date(ticket.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
  const lastMsg =
    ticket.messages && ticket.messages.length > 0
      ? ticket.messages[ticket.messages.length - 1].text
      : 'No messages yet';

  const id = ticket.ticketId || ticket.id || '';
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(ticket)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <Text style={styles.ticketId}>#{id.slice(-6).toUpperCase()}</Text>
        <Badge label={badge.label} variant={badge.variant} />
      </View>

      <Text style={styles.subject} numberOfLines={1}>
        {ticket.subject}
      </Text>

      <Text style={styles.lastMessage} numberOfLines={2}>
        {lastMsg}
      </Text>

      <View style={styles.footer}>
        <Text style={styles.category}>{ticket.category.replace('_', ' ')}</Text>
        <Text style={styles.date}>{formattedDate}</Text>
      </View>
    </TouchableOpacity>
  );
};
