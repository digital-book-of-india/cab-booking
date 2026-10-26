import React, { useCallback, useEffect, useState } from 'react';
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
import { NotificationsService } from '../../../src/services/notifications.service';
import { styles } from '../../../src/styles/notifications.styles';
import type { AppNotification } from '../../../src/types/notification.types';

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const data = await NotificationsService.listNotifications();
      setNotifications(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchNotifications();
    setRefreshing(false);
  };

  const handleMarkAllRead = async () => {
    try {
      await NotificationsService.markRead({ all: true });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // ignore
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
      default:
        return 'notifications';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header
        title="Notifications"
        showBack
        onBack={() => router.back()}
        rightElement={
          notifications.some((n) => !n.read) ? (
            <TouchableOpacity onPress={handleMarkAllRead}>
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderItem={({ item }) => (
          <View style={[styles.notifItem, !item.read && styles.notifItemUnread]}>
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
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
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
