import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../../constants/colors";
import { styles } from "../../styles/home/ServiceCategories.styles";

export interface CategoryItem {
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: string;
  serviceId: string;
}

const CATEGORIES: CategoryItem[] = [
  {
    id: "ride",
    title: "Ride",
    icon: "car-sport",
    badge: "25%",
    serviceId: "MINI",
  },
  {
    id: "bus_metro",
    title: "Bus & Metro",
    icon: "bus",
    badge: "Promo",
    serviceId: "MINI",
  },
  {
    id: "intercity",
    title: "Intercity",
    icon: "navigate",
    badge: "7%",
    serviceId: "SEDAN",
  },
  {
    id: "seniors",
    title: "Seniors",
    icon: "body",
    serviceId: "MINI",
  },
  {
    id: "reserve",
    title: "Reserve",
    icon: "calendar",
    badge: "7%",
    serviceId: "SEDAN",
  },
  {
    id: "parcel",
    title: "Parcel",
    icon: "cube",
    serviceId: "MINI",
  },
];

interface ServiceCategoriesProps {
  onSelectCategory: (serviceId: string, title: string) => void;
  title?: string;
}

export const ServiceCategories: React.FC<ServiceCategoriesProps> = ({
  onSelectCategory,
  title = "For you",
}) => {
  return (
    <View style={styles.container}>
      {/* Header title like the screenshot ("For you ›") */}
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>{title}</Text>
        <Ionicons
          name="chevron-forward"
          size={16}
          color={COLORS.textSecondary}
        />
      </View>

      {/* 2 Rows x 3 Columns Circular Grid */}
      <View style={styles.grid}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={styles.itemWrapper}
            onPress={() => onSelectCategory(cat.serviceId, cat.title)}
            activeOpacity={0.7}
          >
            <View style={styles.circleContainer}>
              {/* Optional Red Promo/Discount Badge */}
              {cat.badge && (
                <View style={styles.badgePill}>
                  <Ionicons name="pricetag" size={8} color="#FFFFFF" />
                  <Text style={styles.badgeText}>{cat.badge}</Text>
                </View>
              )}

              {/* Circular Avatar Container */}
              <View style={styles.circle}>
                <Ionicons name={cat.icon} size={30} color={COLORS.text} />
              </View>
            </View>

            {/* Label below circle */}
            <Text style={styles.label} numberOfLines={1}>
              {cat.title}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};
