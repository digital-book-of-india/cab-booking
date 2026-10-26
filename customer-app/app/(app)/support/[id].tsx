import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge } from '../../../src/components/common/Badge';
import { Header } from '../../../src/components/common/Header';
import { COLORS } from '../../../src/constants/colors';
import { SupportService } from '../../../src/services/support.service';
import { styles } from '../../../src/styles/ticketDetail.styles';
import type { SupportTicket, TicketMessage } from '../../../src/types/support.types';

export default function TicketDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const ticketId = params.id;
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  const fetchTicket = useCallback(async () => {
    if (!ticketId) return;
    try {
      setLoading(true);
      const data = await SupportService.getTicket(ticketId);
      setTicket(data);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not fetch ticket');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  const handleSendReply = async () => {
    if (!replyText.trim() || !ticketId) return;
    try {
      setSending(true);
      const newMsg = await SupportService.reply(ticketId, replyText.trim());
      setTicket((prev) =>
        prev
          ? {
              ...prev,
              messages: [...(prev.messages || []), newMsg],
            }
          : null,
      );
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
        onPress: async () => {
          try {
            await SupportService.closeTicket(ticketId);
            setTicket((prev) => (prev ? { ...prev, status: 'CLOSED' } : null));
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
        <Header title="Support Conversation" showBack />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const isClosed = ticket.status === 'CLOSED' || ticket.status === 'RESOLVED';

  const renderMessage = ({ item }: { item: TicketMessage }) => {
    const isCustomer = item.senderRole === 'CUSTOMER';
    const formattedTime = new Date(item.createdAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

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
          <Text
            style={[
              styles.msgTime,
              isCustomer ? styles.timeCustomer : styles.timeSupport,
            ]}
          >
            {formattedTime}
          </Text>
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
          <Badge
            label={ticket.status}
            variant={
              ticket.status === 'OPEN'
                ? 'warning'
                : ticket.status === 'RESOLVED'
                ? 'success'
                : 'neutral'
            }
          />
        </View>
        <Text style={styles.categoryText}>Category: {ticket.category.replace('_', ' ')}</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <FlatList
          data={ticket.messages || []}
          keyExtractor={(item, index) => item.id || String(index)}
          contentContainerStyle={styles.messagesList}
          renderItem={renderMessage}
        />

        {!isClosed ? (
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              placeholder="Type your message..."
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
              <Ionicons name="send" size={18} color={COLORS.white} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.closedBanner}>
            <Text style={styles.closedText}>This support ticket has been closed.</Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
