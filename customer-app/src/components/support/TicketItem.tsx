import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { SupportTicket, TicketStatus } from '../../types/support.types';
import { Badge, type BadgeVariant } from '../common/Badge';
import { styles } from './TicketItem.styles';

export type TicketItemProps = {
  ticket: SupportTicket;
  onPress: (ticket: SupportTicket) => void;
};

const getStatusBadge = (status?: TicketStatus): { label: string; variant: BadgeVariant } => {
  switch (status) {
    case 'OPEN':
      return { label: 'Open', variant: 'warning' };
    case 'IN_PROGRESS':
      return { label: 'In Progress', variant: 'info' };
    case 'WAITING_USER':
      return { label: 'Waiting for You', variant: 'warning' };
    case 'RESOLVED':
      return { label: 'Resolved', variant: 'success' };
    case 'CLOSED':
    default:
      return { label: 'Closed', variant: 'neutral' };
  }
};

export const TicketItem: React.FC<TicketItemProps> = ({ ticket, onPress }) => {
  const badge = getStatusBadge(ticket.status);
  let formattedDate = '';
  try {
    const rawDate = ticket.lastActivityAt || ticket.createdAt;
    if (rawDate) {
      formattedDate = new Date(rawDate).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
      });
    }
  } catch {
    formattedDate = '';
  }

  // Determine snippet to show
  let previewSnippet = 'Conversation active';
  if (ticket.lastMessage) {
    previewSnippet =
      (ticket.lastMessage.by === 'STAFF' ? 'Support: ' : 'You: ') + ticket.lastMessage.text;
  } else if (ticket.messages && ticket.messages.length > 0) {
    const last = ticket.messages[ticket.messages.length - 1];
    previewSnippet = (last.by === 'STAFF' ? 'Support: ' : 'You: ') + last.text;
  } else if (typeof ticket.messageCount === 'number' && ticket.messageCount > 0) {
    previewSnippet = `${ticket.messageCount} message${ticket.messageCount > 1 ? 's' : ''} in conversation`;
  } else if (ticket.resolutionNote) {
    previewSnippet = `Resolution: ${ticket.resolutionNote}`;
  } else {
    previewSnippet = 'Waiting for support agent assignment';
  }

  const id = ticket.ticketId || ticket.id || '';
  const categoryLabel = (ticket.category || 'SUPPORT').replace(/_/g, ' ');

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(ticket)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.ticketId}>#{id ? id.slice(-6).toUpperCase() : 'TICKET'}</Text>
          {ticket.priority === 'HIGH' && (
            <View
              style={{
                backgroundColor: '#FEF2F2',
                borderRadius: 4,
                paddingHorizontal: 5,
                paddingVertical: 1,
              }}
            >
              <Text style={{ fontSize: 10, color: '#DC2626', fontWeight: '700' }}>PRIORITY</Text>
            </View>
          )}
        </View>
        <Badge label={badge.label} variant={badge.variant} />
      </View>

      <Text style={styles.subject} numberOfLines={1}>
        {ticket.subject}
      </Text>

      <Text style={styles.lastMessage} numberOfLines={2}>
        {previewSnippet}
      </Text>

      <View style={styles.footer}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={styles.category}>{categoryLabel}</Text>
          {ticket.bookingId && (
            <Text style={[styles.category, { color: '#64748B' }]}>
              • Ride #{ticket.bookingId.slice(-6).toUpperCase()}
            </Text>
          )}
        </View>
        <Text style={styles.date}>{formattedDate}</Text>
      </View>
    </TouchableOpacity>
  );
};
