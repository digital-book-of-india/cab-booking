import React, { useEffect } from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../../../src/components/common/EmptyState';
import { Header } from '../../../src/components/common/Header';
import { COLORS } from '../../../src/constants/colors';
import { useNotifications } from '../../../src/context/NotificationContext';
import { styles } from '../../../src/styles/notifications.styles';
import type { AppNotification } from '../../../src/types/notification.types';

export default function NotificationsScreen() {
  const {
    notifications,
    isLoading,
    isRefreshing,
    fetchNotifications,
    markAllAsRead,
    markAsRead,
  } = useNotifications();

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = async () => {
    await fetchNotifications(true);
  };

  const handleNotificationPress = async (item: AppNotification) => {
    if (!item.read) {
      await markAsRead(item.id);
    }

    const data = item.data || (item.metadata as Record<string, string> | undefined) || {};

    // Deep linking routing
    switch (item.type) {
      case 'RIDE_UPDATE': {
        const rideId = data.bookingId || data.rideId;
        if (rideId) {
          router.push(`/(app)/rides/${rideId}` as any);
        } else {
          router.push('/(app)/rides' as any);
        }
        break;
      }
      case 'PAYMENT_UPDATE': {
        router.push('/(app)/wallet');
        break;
      }
      case 'SUPPORT_UPDATE': {
        const ticketId = data.ticketId;
        if (ticketId) {
          router.push(`/(app)/support/${ticketId}` as any);
        } else {
          router.push('/(app)/support/tickets' as any);
        }
        break;
      }
      case 'PROMO': {
        router.push('/(app)/rewards' as any);
        break;
      }
      case 'SECURITY': {
        router.push('/(app)/sessions' as any);
        break;
      }
      default:
        // No specific deep link
        break;
    }
  };

  const getNotifIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'RIDE_UPDATE':
        return 'car';
      case 'PAYMENT_UPDATE':
        return 'card';
      case 'PROMO':
        return 'pricetag';
      case 'SUPPORT_UPDATE':
        return 'headset';
      case 'SECURITY':
        return 'shield-checkmark';
      default:
        return 'notifications';
    }
  };

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Notifications"
        showBack
        onBack={() => router.back()}
        rightElement={
          hasUnread ? (
            <TouchableOpacity onPress={markAllAsRead}>
              <Text style={{ fontSize: 13, color: COLORS.primary, fontWeight: '600' }}>
                Read All
              </Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <FlatList
        data={notifications}
        keyExtractor={(item, index) => item.id || String(index)}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.notifItem, !item.read && styles.notifItemUnread]}
            onPress={() => handleNotificationPress(item)}
            activeOpacity={0.7}
          >
            <View style={styles.iconBox}>
              <Ionicons
                name={getNotifIcon(item.type)}
                size={20}
                color={COLORS.primary}
              />
            </View>
            <View style={styles.content}>
              <View style={styles.headerRow}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                {!item.read && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.date}>
                {new Date(item.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              icon="notifications-off-outline"
              title="No notifications"
              subtitle="You're all caught up! Updates about your rides and promotions will appear here."
            />
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}
