import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, type BadgeVariant } from '../../../src/components/common/Badge';
import { Header } from '../../../src/components/common/Header';
import { COLORS } from '../../../src/constants/colors';
import { SupportService } from '../../../src/services/support.service';
import { styles } from '../../../src/styles/ticketDetail.styles';
import type { SupportTicket, TicketMessage, TicketStatus } from '../../../src/types/support.types';

export default function TicketDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const ticketId = params.id;
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const fetchTicket = useCallback(async (isInitial = false) => {
    if (!ticketId) return;
    try {
      if (isInitial) setLoading(true);
      const data = await SupportService.getTicket(ticketId);
      setTicket(data);
    } catch (err) {
      if (isInitial) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Could not fetch ticket');
        router.back();
      }
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchTicket(true);
  }, [fetchTicket]);

  // Periodic polling for active conversation updates
  useEffect(() => {
    if (!ticketId) return;
    if (ticket && (ticket.status === 'CLOSED' || ticket.status === 'RESOLVED')) return;

    const timer = setInterval(() => {
      fetchTicket(false);
    }, 5000);

    return () => clearInterval(timer);
  }, [ticketId, ticket?.status, fetchTicket]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTicket(false);
    setRefreshing(false);
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !ticketId) return;
    try {
      setSending(true);
      const updatedTicket = await SupportService.reply(ticketId, replyText.trim());
      setTicket(updatedTicket);
      setReplyText('');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const handleCloseTicket = () => {
    if (!ticketId) return;
    Alert.alert('Close Ticket', 'Are you sure your issue is resolved?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close Ticket',
        style: 'destructive',
        onPress: async () => {
          try {
            const closedTicket = await SupportService.closeTicket(ticketId);
            setTicket(closedTicket);
            Alert.alert('Ticket Closed', 'This ticket has been marked as closed.');
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Could not close ticket');
          }
        },
      },
    ]);
  };

  if (loading || !ticket) {
    return (
      <SafeAreaView style={styles.container}>
        <Header title="Support Conversation" showBack onBack={() => router.back()} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const isClosed = ticket.status === 'CLOSED';
  const isResolved = ticket.status === 'RESOLVED';

  const getStatusBadge = (status: TicketStatus): { label: string; variant: BadgeVariant } => {
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

  const statusBadge = getStatusBadge(ticket.status);

  const renderMessage = ({ item }: { item: TicketMessage }) => {
    const isCustomer = item.by === 'USER' || (item as unknown as { senderRole?: string }).senderRole === 'CUSTOMER';
    const rawTime = item.at || (item as unknown as { createdAt?: string }).createdAt || new Date().toISOString();
    let formattedTime = '';
    try {
      formattedTime = new Date(rawTime).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      formattedTime = '';
    }

    return (
      <View
        style={[
          styles.msgContainer,
          isCustomer ? styles.msgCustomer : styles.msgSupport,
        ]}
      >
        <View
          style={[
            styles.msgBubble,
            isCustomer ? styles.bubbleCustomer : styles.bubbleSupport,
          ]}
        >
          <Text
            style={[
              styles.msgText,
              isCustomer ? styles.textCustomer : styles.textSupport,
            ]}
          >
            {item.text}
          </Text>
          {Boolean(formattedTime) && (
            <Text
              style={[
                styles.msgTime,
                isCustomer ? styles.timeCustomer : styles.timeSupport,
              ]}
            >
              {formattedTime}
            </Text>
          )}
        </View>
      </View>
    );
  };

  const ticketDisplayId = ticket.ticketId || ticket.id || '';

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title={`#${ticketDisplayId.slice(-6).toUpperCase()}`}
        showBack
        onBack={() => router.back()}
        rightElement={
          !isClosed ? (
            <TouchableOpacity onPress={handleCloseTicket}>
              <Text style={{ fontSize: 13, color: COLORS.error, fontWeight: '600' }}>
                Close
              </Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <View style={styles.headerBanner}>
        <View style={styles.subjectRow}>
          <Text style={styles.subjectText} numberOfLines={1}>
            {ticket.subject}
          </Text>
          <Badge label={statusBadge.label} variant={statusBadge.variant} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}>
          <Text style={styles.categoryText}>
            Category: {(ticket.category || 'SUPPORT').replace(/_/g, ' ')}
          </Text>
          {ticket.bookingId && (
            <Text style={[styles.categoryText, { color: COLORS.primary }]}>
              • Ride: #{ticket.bookingId.slice(-6).toUpperCase()}
            </Text>
          )}
        </View>
      </View>

      {/* Resolution Outcome Banner */}
      {isResolved && (
        <View
          style={{
            marginHorizontal: 16,
            marginTop: 8,
            padding: 12,
            borderRadius: 12,
            backgroundColor: '#F0FDF4',
            borderWidth: 1,
            borderColor: '#BBF7D0',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#166534' }}>
              Issue Resolved {ticket.outcome ? `(${ticket.outcome.replace(/_/g, ' ')})` : ''}
            </Text>
          </View>
          {Boolean(ticket.resolutionNote) && (
            <Text style={{ fontSize: 12, color: '#15803D', lineHeight: 17 }}>
              {ticket.resolutionNote}
            </Text>
          )}
          <Text style={{ fontSize: 11, color: '#166534', marginTop: 6, fontStyle: 'italic' }}>
            If you need more help, reply below to reopen this ticket.
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <FlatList
          data={ticket.messages || []}
          keyExtractor={(item, index) => item.id || String(index)}
          contentContainerStyle={styles.messagesList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
            />
          }
          renderItem={renderMessage}
          ListEmptyComponent={
            <Text style={{ textAlign: 'center', color: COLORS.textSecondary, marginTop: 32 }}>
              No messages in this ticket yet.
            </Text>
          }
        />

        {!isClosed ? (
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              placeholder={isResolved ? "Reply to reopen ticket..." : "Type your message..."}
              placeholderTextColor={COLORS.textSecondary}
              value={replyText}
              onChangeText={setReplyText}
              multiline
            />
            <TouchableOpacity
              style={[
                styles.sendBtn,
                (!replyText.trim() || sending) && { backgroundColor: COLORS.disabled },
              ]}
              onPress={handleSendReply}
              disabled={!replyText.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Ionicons name="send" size={18} color={COLORS.white} />
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.closedBanner}>
            <Ionicons name="lock-closed" size={16} color={COLORS.textSecondary} style={{ marginRight: 6 }} />
            <Text style={styles.closedText}>This support ticket has been closed.</Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
