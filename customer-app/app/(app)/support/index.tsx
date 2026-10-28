import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Header } from "../../../src/components/common/Header";
import { IssueModal } from "../../../src/components/support/IssueModal";
import { TicketItem } from "../../../src/components/support/TicketItem";
import { COLORS } from "../../../src/constants/colors";
import { RidesService } from "../../../src/services/rides.service";
import { SupportService } from "../../../src/services/support.service";
import { styles } from "../../../src/styles/support.styles";
import type { RideHistoryItem } from "../../../src/types/ride.types";
import {
  HELP_CATEGORIES,
  type HelpCategory,
  type HelpCategoryKey,
  type HelpSubIssue,
  type SupportTicket,
  type TicketCategory,
} from "../../../src/types/support.types";

export default function SupportTicketsScreen() {
  const params = useLocalSearchParams<{ rideId?: string }>();

  // Tickets & Recent Ride State
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [recentRide, setRecentRide] = useState<RideHistoryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Search & Accordion State
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategory, setExpandedCategory] =
    useState<HelpCategoryKey | null>("RIDES");

  // Issue Modal State
  const [issueModalVisible, setIssueModalVisible] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<{
    title: string;
    category: TicketCategory;
    requiresRide: boolean;
    bookingId?: string;
  }>({
    title: "",
    category: "OTHER",
    requiresRide: false,
  });

  // Safe data loader
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [ticketsData, ridesData] = await Promise.allSettled([
        SupportService.listTickets(),
        RidesService.getHistory(),
      ]);

      if (
        ticketsData.status === "fulfilled" &&
        Array.isArray(ticketsData.value)
      ) {
        setTickets(ticketsData.value);
      } else {
        setTickets([]);
      }

      if (
        ridesData.status === "fulfilled" &&
        Array.isArray(ridesData.value) &&
        ridesData.value.length > 0
      ) {
        setRecentRide(ridesData.value[0]);
      }
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Real-Time Search Filter
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: { category: HelpCategory; issue: HelpSubIssue }[] = [];
    HELP_CATEGORIES.forEach((cat) => {
      cat.subIssues.forEach((issue) => {
        if (
          issue.title.toLowerCase().includes(q) ||
          cat.title.toLowerCase().includes(q) ||
          (issue.description && issue.description.toLowerCase().includes(q))
        ) {
          results.push({ category: cat, issue });
        }
      });
    });
    return results;
  }, [searchQuery]);

  const handleSubIssuePress = (issue: HelpSubIssue) => {
    if (issue.actionType === "CALL") {
      Linking.openURL("tel:18001234567").catch(() => {
        Alert.alert(
          "Customer Care",
          "Helpline: 1800-123-4567\nAvailable 24/7 for emergency ride assistance."
        );
      });
      return;
    }

    if (issue.id === "a_3" || issue.id === "a_4") {
      router.navigate("/(app)/profile" as any);
      return;
    }

    setSelectedIssue({
      title: issue.title,
      category: issue.backendCategory,
      requiresRide: Boolean(issue.requiresRide),
      bookingId: recentRide?.bookingId || recentRide?.id,
    });
    setIssueModalVisible(true);
  };

  const handleReportRecentRide = () => {
    if (!recentRide) return;
    const dropName =
      recentRide.dropLabel || recentRide.dropoff?.address || "Trip";
    setSelectedIssue({
      title: `Issue with ride to ${dropName}`,
      category: "FARE_DISPUTE",
      requiresRide: true,
      bookingId: recentRide.bookingId || recentRide.id,
    });
    setIssueModalVisible(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Help & Support" showBack onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={COLORS.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search issues (e.g. driver, refund, lost item)..."
            placeholderTextColor={COLORS.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons
                name="close-circle"
                size={18}
                color={COLORS.textSecondary}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Search Results */}
        {searchQuery.trim().length > 0 ? (
          <View style={{ marginBottom: 16 }}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Search Results ({searchResults.length})
              </Text>
            </View>

            {searchResults.length > 0 ? (
              <View style={styles.categoryCard}>
                {searchResults.map(({ category, issue }) => (
                  <TouchableOpacity
                    key={issue.id}
                    style={styles.subIssueItem}
                    onPress={() => handleSubIssuePress(issue)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.subIssueLeft}>
                      <Ionicons
                        name={category.icon}
                        size={16}
                        color={category.iconColor}
                      />
                      <Text style={styles.subIssueTitle}>{issue.title}</Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={COLORS.textSecondary}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text
                style={{
                  textAlign: "center",
                  color: COLORS.textSecondary,
                  marginVertical: 24,
                }}
              >
                No matching issues found. Try typing another keyword.
              </Text>
            )}
          </View>
        ) : (
          <>
            {/* Quick Action Bar (Call, Live Chat, Tickets) */}
            <View style={styles.contactRow}>
              <TouchableOpacity
                style={styles.contactBtn}
                onPress={() => Linking.openURL("tel:18001234567")}
                activeOpacity={0.7}
              >
                <Ionicons name="call" size={16} color="#16A34A" />
                <Text style={styles.contactBtnText}>Call Helpline</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.contactBtn}
                onPress={() => {
                  setSelectedIssue({
                    title: "Live Chat Support Request",
                    category: "OTHER",
                    requiresRide: false,
                  });
                  setIssueModalVisible(true);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="chatbubbles" size={16} color="#2563EB" />
                <Text style={styles.contactBtnText}>Live Chat</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.contactBtn}
                onPress={() => {
                  Alert.alert(
                    "My Requests",
                    `You have ${tickets.length} support requests on record.`
                  );
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="ticket" size={16} color="#D97706" />
                <Text style={styles.contactBtnText}>
                  Tickets ({tickets.length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Recent Trip Card */}
            {recentRide && (
              <View style={styles.recentTripCard}>
                <View style={styles.recentTripHeader}>
                  <View style={styles.recentTripBadge}>
                    <Text style={styles.recentTripBadgeText}>RECENT TRIP</Text>
                  </View>
                  <Text style={styles.recentTripDate}>
                    {recentRide.createdAt ? new Date(recentRide.createdAt).toDateString().slice(4, 10) : 'Recent'}
                  </Text>
                </View>

                <Text style={styles.recentTripRoute} numberOfLines={1}>
                  {recentRide.dropLabel ||
                    recentRide.dropoff?.address ||
                    "Completed Ride"}
                </Text>

                <View style={styles.recentTripFooter}>
                  <Text style={styles.recentTripFare}>
                    ₹
                    {(
                      (recentRide.farePaise ??
                        recentRide.estimatedFarePaise ??
                        0) / 100
                    ).toFixed(0)}
                  </Text>
                  <TouchableOpacity onPress={handleReportRecentRide}>
                    <Text style={styles.reportRideLink}>
                      Need help with this trip? →
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* 6 Help Categories (Accordion Sections) */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Browse All Issues</Text>
            </View>

            {HELP_CATEGORIES.map((cat) => {
              const isExpanded = expandedCategory === cat.key;
              return (
                <View key={cat.key} style={styles.categoryCard}>
                  <TouchableOpacity
                    style={styles.categoryHeader}
                    onPress={() =>
                      setExpandedCategory(isExpanded ? null : cat.key)
                    }
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.categoryIconBox,
                        { backgroundColor: cat.iconBg },
                      ]}
                    >
                      <Ionicons
                        name={cat.icon}
                        size={22}
                        color={cat.iconColor}
                      />
                    </View>
                    <View style={styles.categoryTextContainer}>
                      <Text style={styles.categoryTitle}>{cat.title}</Text>
                      <Text style={styles.categorySubtitle} numberOfLines={1}>
                        {cat.subtitle}
                      </Text>
                    </View>
                    <Ionicons
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={20}
                      color={COLORS.textSecondary}
                    />
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.subIssuesContainer}>
                      {cat.subIssues.map((sub) => (
                        <TouchableOpacity
                          key={sub.id}
                          style={styles.subIssueItem}
                          onPress={() => handleSubIssuePress(sub)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.subIssueLeft}>
                            <View style={styles.subIssueDot} />
                            <Text style={styles.subIssueTitle}>
                              {sub.title}
                            </Text>
                          </View>
                          <Ionicons
                            name="chevron-forward"
                            size={16}
                            color={COLORS.textSecondary}
                          />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}

            {/* Previous Tickets */}
            {tickets.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>
                    Your Previous Requests
                  </Text>
                </View>

                {tickets.map((t, index) => (
                  <TicketItem
                    key={t.ticketId || t.id || String(index)}
                    ticket={t}
                    onPress={(ticket) =>
                      router.navigate({
                        pathname: "/(app)/support/[id]",
                        params: { id: ticket.ticketId || ticket.id || "" },
                      })
                    }
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Universal Issue Modal */}
      <IssueModal
        visible={issueModalVisible}
        onClose={() => setIssueModalVisible(false)}
        subIssueTitle={selectedIssue.title}
        backendCategory={selectedIssue.category}
        requiresRide={selectedIssue.requiresRide}
        initialBookingId={selectedIssue.bookingId}
        onTicketCreated={(newTicket) =>
          setTickets((prev) => [newTicket, ...prev])
        }
      />
    </SafeAreaView>
  );
}
