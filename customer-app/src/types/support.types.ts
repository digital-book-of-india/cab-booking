import type { Ionicons } from "@expo/vector-icons";

/* ========================================================
 * 1. Existing Ticket Data Contracts (Backend Compatible)
 * ======================================================== */
export type TicketStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_USER"
  | "RESOLVED"
  | "CLOSED";

export type TicketCategory =
  | "FARE_DISPUTE"
  | "PAYMENT_ISSUE"
  | "DRIVER_BEHAVIOUR"
  | "RIDER_BEHAVIOUR"
  | "LOST_ITEM"
  | "SAFETY_CONCERN"
  | "APP_PROBLEM"
  | "OTHER";

export type TicketMessage = {
  id?: string;
  senderRole?: "CUSTOMER" | "SUPPORT" | "SYSTEM" | string;
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

/* ========================================================
 * 2. 6 Help Center Categories & Sub-Issue Definitions
 * ======================================================== */
export type HelpCategoryKey =
  | "RIDES"
  | "PAYMENTS"
  | "CONTACT"
  | "LOST_FOUND"
  | "ACCOUNT"
  | "OFFERS";

export type HelpSubIssue = {
  id: string;
  title: string;
  description?: string;
  backendCategory: TicketCategory;
  actionType: "TICKET" | "RIDE_SELECT" | "CALL" | "CHAT" | "LINK";
  requiresRide?: boolean;
};

export type HelpCategory = {
  key: HelpCategoryKey;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  subIssues: HelpSubIssue[];
};

export const HELP_CATEGORIES: HelpCategory[] = [
  // 1. My Rides & Ride Issues
  {
    key: "RIDES",
    title: "My Rides & Ride Issues",
    subtitle: "Driver issues, cancellations, pickup/drop, fare disputes",
    icon: "car-sport",
    iconColor: "#2563EB",
    iconBg: "#EFF6FF",
    subIssues: [
      {
        id: "r_1",
        title: "Driver didn't arrive",
        backendCategory: "OTHER",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "r_2",
        title: "Driver asked me to cancel",
        backendCategory: "DRIVER_BEHAVIOUR",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "r_3",
        title: "Ride was cancelled unexpectedly",
        backendCategory: "FARE_DISPUTE",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "r_4",
        title: "Incorrect pickup or drop location",
        backendCategory: "FARE_DISPUTE",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "r_5",
        title: "Charged a cancellation fee",
        backendCategory: "FARE_DISPUTE",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "r_6",
        title: "Fare was higher than expected",
        backendCategory: "FARE_DISPUTE",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "r_7",
        title: "Complaint about driver behavior",
        backendCategory: "DRIVER_BEHAVIOUR",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
    ],
  },

  // 2. Payments & Refunds
  {
    key: "PAYMENTS",
    title: "Payments & Refunds",
    subtitle: "Failed payments, deduction disputes, refund status & bills",
    icon: "card",
    iconColor: "#D97706",
    iconBg: "#FEF3C7",
    subIssues: [
      {
        id: "p_1",
        title: "Payment failed",
        backendCategory: "PAYMENT_ISSUE",
        actionType: "TICKET",
      },
      {
        id: "p_2",
        title: "Money deducted but booking failed",
        backendCategory: "PAYMENT_ISSUE",
        actionType: "TICKET",
      },
      {
        id: "p_3",
        title: "Incorrect fare or extra charges",
        backendCategory: "FARE_DISPUTE",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "p_4",
        title: "Cash payment dispute",
        backendCategory: "PAYMENT_ISSUE",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "p_5",
        title: "Refund status inquiry",
        backendCategory: "PAYMENT_ISSUE",
        actionType: "TICKET",
      },
      {
        id: "p_6",
        title: "Payment receipt or invoice request",
        backendCategory: "PAYMENT_ISSUE",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "p_7",
        title: "Promo code or discount issue",
        backendCategory: "PAYMENT_ISSUE",
        actionType: "TICKET",
      },
    ],
  },

  // 3. Contact Customer Support
  {
    key: "CONTACT",
    title: "Contact Customer Support",
    subtitle: "Call helpline, live chat, or raise a support ticket",
    icon: "headset",
    iconColor: "#16A34A",
    iconBg: "#F0FDF4",
    subIssues: [
      {
        id: "c_1",
        title: "Call 24/7 Support Hotline",
        description: "Toll-free customer assistance",
        backendCategory: "OTHER",
        actionType: "CALL",
      },
      {
        id: "c_2",
        title: "Live chat with a support agent",
        description: "Instant resolution via support desk",
        backendCategory: "OTHER",
        actionType: "CHAT",
      },
      {
        id: "c_3",
        title: "Create a custom support ticket",
        backendCategory: "OTHER",
        actionType: "TICKET",
      },
      {
        id: "c_4",
        title: "Track support request status",
        backendCategory: "OTHER",
        actionType: "LINK",
      },
      {
        id: "c_5",
        title: "View previous conversations",
        backendCategory: "OTHER",
        actionType: "LINK",
      },
    ],
  },

  // 4. Lost & Found
  {
    key: "LOST_FOUND",
    title: "Lost & Found",
    subtitle: "Recover items left in cab & connect with driver",
    icon: "search",
    iconColor: "#7C3AED",
    iconBg: "#F5F3FF",
    subIssues: [
      {
        id: "lf_1",
        title: "I lost an item in the cab",
        backendCategory: "LOST_ITEM",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "lf_2",
        title: "Request assistance contacting driver",
        backendCategory: "LOST_ITEM",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "lf_3",
        title: "Track item recovery status",
        backendCategory: "LOST_ITEM",
        actionType: "LINK",
      },
    ],
  },

  // 5. Account & Profile Issues
  {
    key: "ACCOUNT",
    title: "Account & Profile Issues",
    subtitle: "Login, OTP, update credentials & security report",
    icon: "person",
    iconColor: "#0284C7",
    iconBg: "#F0F9FF",
    subIssues: [
      {
        id: "a_1",
        title: "Unable to log in",
        backendCategory: "APP_PROBLEM",
        actionType: "TICKET",
      },
      {
        id: "a_2",
        title: "OTP not received",
        backendCategory: "APP_PROBLEM",
        actionType: "TICKET",
      },
      {
        id: "a_3",
        title: "Change phone number or email",
        backendCategory: "OTHER",
        actionType: "LINK",
      },
      {
        id: "a_4",
        title: "Update profile details",
        backendCategory: "OTHER",
        actionType: "LINK",
      },
      {
        id: "a_5",
        title: "Delete account request",
        backendCategory: "OTHER",
        actionType: "TICKET",
      },
      {
        id: "a_6",
        title: "Report unauthorized account activity",
        backendCategory: "SAFETY_CONCERN",
        actionType: "TICKET",
      },
    ],
  },

  // 6. Offers & Rewards
  {
    key: "OFFERS",
    title: "Offers & Rewards",
    subtitle: "Promo codes, discounts, cashback & referral bonuses",
    icon: "pricetag",
    iconColor: "#DB2777",
    iconBg: "#FDF2F8",
    subIssues: [
      {
        id: "o_1",
        title: "Promo code not working",
        backendCategory: "OTHER",
        actionType: "TICKET",
      },
      {
        id: "o_2",
        title: "Discount not applied on ride",
        backendCategory: "FARE_DISPUTE",
        actionType: "RIDE_SELECT",
        requiresRide: true,
      },
      {
        id: "o_3",
        title: "Referral reward not received",
        backendCategory: "OTHER",
        actionType: "TICKET",
      },
      {
        id: "o_4",
        title: "Cashback or wallet credit missing",
        backendCategory: "PAYMENT_ISSUE",
        actionType: "TICKET",
      },
    ],
  },
];
