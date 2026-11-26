import React from 'react';
import {
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppButton } from '../common/AppButton';
import { COLORS } from '../../constants/colors';
import { useRideBookingSheet } from '../../hooks/useRideBookingSheet';
import { QuotesService } from '../../services/quotes.service';
import { styles } from '../../styles/home/RideBookingModal.styles';
import type {
  LocationPoint,
  ServiceabilityResponse,
  TripMode,
} from '../../types/location.types';
import type { Coordinates } from '../../types/ride.types';
import { BookingConfirmView } from './BookingConfirmView';
import { CabCategoryList } from './CabCategoryList';
import { FareEstimateSheet } from './FareEstimateSheet';
import { HomeMap } from './HomeMap';
import { LocationSearchModal } from './LocationSearchModal';
import { PaymentCouponBar } from './PaymentCouponBar';
import { PinAdjusterModal } from './PinAdjusterModal';
import { RoutePickerCard } from './RoutePickerCard';
import { ServiceabilityAlert } from './ServiceabilityAlert';

export type RideBookingModalProps = {
  visible: boolean;
  onClose: () => void;
  initialServiceId?: string;
  walletBalancePaise?: number;
  currentCoords?: Coordinates | null;
  initialPickup?: LocationPoint | null;
  initialDrop?: LocationPoint | null;
  initialZoneServiceability?: ServiceabilityResponse | null;
  initialTripMode?: TripMode;
  autoOpenSearchField?: 'pickup' | 'drop' | null;
};

const TRIP_MODE_TABS: { mode: TripMode; label: string }[] = [
  { mode: 'CITY', label: 'City Ride' },
  { mode: 'RENTAL', label: 'Rentals' },
  { mode: 'OUTSTATION', label: 'Outstation' },
];

const SCHEDULE_PRESETS: { label: string; offsetMs: number | null }[] = [
  { label: 'Now', offsetMs: null },
  { label: 'In 45m', offsetMs: 45 * 60_000 },
  { label: 'In 2h', offsetMs: 2 * 3_600_000 },
  { label: 'Tomorrow', offsetMs: 24 * 3_600_000 },
];

const RETURN_DAY_PRESETS: { label: string; days: number }[] = [
  { label: '+1 Day', days: 1 },
  { label: '+2 Days', days: 2 },
  { label: '+3 Days', days: 3 },
];

export const RideBookingModal: React.FC<RideBookingModalProps> = (props) => {
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      transparent
      onRequestClose={props.onClose}
    >
      {props.visible ? <RideBookingContent {...props} /> : null}
    </Modal>
  );
};

const RideBookingContent: React.FC<RideBookingModalProps> = ({
  visible,
  onClose,
  initialServiceId = 'MINI',
  walletBalancePaise = 125000,
  currentCoords = null,
  initialPickup = null,
  initialDrop = null,
  initialZoneServiceability = null,
  initialTripMode = 'CITY',
  autoOpenSearchField = null,
}) => {
  const [selectedScheduleIndex, setSelectedScheduleIndex] = React.useState(0);
  const [selectedReturnDays, setSelectedReturnDays] = React.useState<number | null>(1);

  const sheet = useRideBookingSheet({
    visible,
    initialServiceId,
    initialPickup,
    initialDrop,
    initialZoneServiceability,
    initialTripMode,
    onClose,
  });

  React.useEffect(() => {
    if (visible && autoOpenSearchField) {
      sheet.openSearchModal(autoOpenSearchField);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoOpenSearchField]);

  const modalTitle =
    sheet.bookingStep === 'CONFIRMED'
      ? 'Ride Confirmed!'
      : sheet.tripMode === 'RENTAL'
      ? 'Hourly Rentals'
      : sheet.tripMode === 'OUTSTATION'
      ? 'Intercity Outstation'
      : 'Choose a Ride';

  const pinInitialCoords =
    sheet.editingStopIndex !== null
      ? sheet.stops[sheet.editingStopIndex] ??
        sheet.dropPoint ??
        sheet.pickupPoint ??
        currentCoords
      : sheet.pinField === 'pickup'
      ? sheet.pickupPoint ?? currentCoords
      : sheet.dropPoint ?? sheet.pickupPoint ?? currentCoords;

  return (
    <>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.dragHandleBar}>
            <View style={styles.dragHandle} />
          </View>

          <View style={styles.headerRow}>
            <Text style={styles.modalTitle}>{modalTitle}</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={sheet.closeModal}>
              <Ionicons name="close" size={20} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {sheet.bookingStep !== 'SELECT' ? (
            <BookingConfirmView step={sheet.bookingStep} onDone={sheet.finishBooking} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modeTabsRow}>
                {TRIP_MODE_TABS.map((tab) => {
                  const active = sheet.tripMode === tab.mode;
                  return (
                    <TouchableOpacity
                      key={tab.mode}
                      style={[styles.modeTab, active && styles.modeTabActive]}
                      onPress={() => sheet.setTripMode(tab.mode)}
                    >
                      <Text
                        style={[
                          styles.modeTabText,
                          active && styles.modeTabTextActive,
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scheduleRow}
              >
                {SCHEDULE_PRESETS.map((preset, idx) => {
                  const active = selectedScheduleIndex === idx;
                  return (
                    <TouchableOpacity
                      key={preset.label}
                      style={[
                        styles.scheduleChip,
                        active && styles.scheduleChipActive,
                      ]}
                      onPress={() => {
                        setSelectedScheduleIndex(idx);
                        const nextScheduled =
                          preset.offsetMs === null
                            ? null
                            : new Date(Date.now() + preset.offsetMs);
                        sheet.setScheduledFor(nextScheduled);
                        if (
                          sheet.tripMode === 'OUTSTATION' &&
                          sheet.outstationTripType === 'ROUND_TRIP' &&
                          selectedReturnDays
                        ) {
                          const base = nextScheduled ?? new Date();
                          sheet.setOutstationReturnAt(
                            new Date(base.getTime() + selectedReturnDays * 86_400_000),
                          );
                        }
                      }}
                    >
                      <Ionicons
                        name={idx === 0 ? 'flash-outline' : 'time-outline'}
                        size={12}
                        color={active ? COLORS.primaryDark : COLORS.textSecondary}
                      />
                      <Text
                        style={[
                          styles.scheduleChipText,
                          active && styles.scheduleChipTextActive,
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <RoutePickerCard
                pickupPoint={sheet.pickupPoint}
                dropPoint={sheet.dropPoint}
                stops={sheet.stops}
                activeField={sheet.activeField}
                tripMode={sheet.tripMode}
                quickLocations={sheet.quickLocations}
                onPressSearchField={sheet.openSearchModal}
                onPressPinField={sheet.openPinModal}
                onPressStopSearch={sheet.openStopSearchModal}
                onPressStopPin={sheet.openStopPinModal}
                onRemoveStop={sheet.removeStop}
                onSelectLocation={sheet.selectQuickLocation}
                onPressManageSavedPlaces={() => {
                  sheet.closeModal();
                  router.push('/(app)/places');
                }}
              />

              {sheet.tripMode !== 'RENTAL' &&
              sheet.pickupPoint &&
              sheet.dropPoint ? (
                <HomeMap
                  compact
                  userCoords={currentCoords}
                  pickupPoint={sheet.pickupPoint}
                  dropPoint={sheet.dropPoint}
                  routeEstimate={sheet.routeEstimate}
                  routeLoading={sheet.routeLoading}
                  onPressAdjustPin={() => sheet.openPinModal(sheet.activeField)}
                />
              ) : null}

              <ServiceabilityAlert
                pickupPoint={sheet.pickupPoint}
                dropPoint={sheet.dropPoint}
                tripMode={sheet.tripMode}
                checkingServiceability={sheet.checkingServiceability}
                tripModeLoading={sheet.tripModeLoading}
                routeLoading={sheet.routeLoading}
                serviceabilityError={sheet.serviceabilityError}
                tripModeError={sheet.tripModeError}
                routeError={sheet.routeError}
                serviceabilityResult={sheet.serviceabilityResult}
                rentalPackages={sheet.rentalPackages}
                outstationOptions={sheet.outstationOptions}
                onRetry={sheet.retryServiceability}
              />

              {sheet.tripMode === 'RENTAL' &&
              sheet.rentalPackages &&
              sheet.rentalPackages.length > 0 ? (
                <View style={styles.tripConfigSection}>
                  <Text style={styles.tripConfigLabel}>Select Rental Package</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.packageScroll}
                  >
                    {sheet.rentalPackages.map((pkg) => {
                      const active = sheet.selectedRentalPackageId === pkg.packageId;
                      return (
                        <TouchableOpacity
                          key={pkg.packageId}
                          style={[
                            styles.packageCard,
                            active && styles.packageCardActive,
                          ]}
                          onPress={() => sheet.setSelectedRentalPackageId(pkg.packageId)}
                        >
                          <Text style={styles.packageTitle}>{pkg.name}</Text>
                          <Text style={styles.packageMeta}>
                            {pkg.hours} hr • {pkg.includedKm} km
                          </Text>
                          <Text style={styles.packagePrice}>
                            {QuotesService.formatPaise(pkg.pricePaise)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              {sheet.tripMode === 'OUTSTATION' &&
              sheet.outstationOptions &&
              sheet.outstationOptions.length > 0 ? (
                <View style={styles.tripConfigSection}>
                  <Text style={styles.tripConfigLabel}>Trip Type</Text>
                  <View style={styles.outstationRow}>
                    {(['ONE_WAY', 'ROUND_TRIP'] as const).map((type) => {
                      const active = sheet.outstationTripType === type;
                      return (
                        <TouchableOpacity
                          key={type}
                          style={[
                            styles.scheduleChip,
                            active && styles.scheduleChipActive,
                          ]}
                          onPress={() => {
                            sheet.setOutstationTripType(type);
                            if (type === 'ROUND_TRIP' && !sheet.outstationReturnAt) {
                              const base = sheet.scheduledFor ?? new Date();
                              setSelectedReturnDays(1);
                              sheet.setOutstationReturnAt(
                                new Date(base.getTime() + 86_400_000),
                              );
                            } else if (type === 'ONE_WAY') {
                              sheet.setOutstationReturnAt(null);
                            }
                          }}
                        >
                          <Text
                            style={[
                              styles.scheduleChipText,
                              active && styles.scheduleChipTextActive,
                            ]}
                          >
                            {type === 'ONE_WAY' ? 'One Way' : 'Round Trip'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {sheet.outstationTripType === 'ROUND_TRIP' ? (
                    <View style={styles.outstationRow}>
                      {RETURN_DAY_PRESETS.map((preset) => {
                        const active = selectedReturnDays === preset.days;
                        return (
                          <TouchableOpacity
                            key={preset.label}
                            style={[
                              styles.scheduleChip,
                              active && styles.scheduleChipActive,
                            ]}
                            onPress={() => {
                              const base = sheet.scheduledFor ?? new Date();
                              setSelectedReturnDays(preset.days);
                              sheet.setOutstationReturnAt(
                                new Date(base.getTime() + preset.days * 86_400_000),
                              );
                            }}
                          >
                            <Text
                              style={[
                                styles.scheduleChipText,
                                active && styles.scheduleChipTextActive,
                              ]}
                            >
                              Return {preset.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {sheet.quoteError || sheet.isSelectedQuoteExpired ? (
                <View
                  style={[
                    styles.quoteBanner,
                    sheet.isSelectedQuoteExpired && styles.quoteBannerWarn,
                  ]}
                >
                  <Ionicons
                    name={
                      sheet.isSelectedQuoteExpired
                        ? 'time-outline'
                        : 'alert-circle-outline'
                    }
                    size={16}
                    color={
                      sheet.isSelectedQuoteExpired ? COLORS.warning : COLORS.error
                    }
                  />
                  <Text style={styles.quoteBannerText}>
                    {sheet.isSelectedQuoteExpired
                      ? 'Your fare quote expired. Refresh to lock the current price.'
                      : sheet.quoteError}
                  </Text>
                  <TouchableOpacity
                    style={styles.quoteBannerAction}
                    onPress={
                      sheet.isSelectedQuoteExpired
                        ? sheet.refreshSelectedQuote
                        : sheet.recalculateQuotes
                    }
                  >
                    <Text style={styles.quoteBannerActionText}>Refresh</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <CabCategoryList
                zoneName={sheet.zoneName}
                loading={sheet.categoriesLoading}
                categories={sheet.displayCategories}
                selectedCategoryId={sheet.selectedCategory?.id}
                onSelectCategory={sheet.setSelectedCategoryId}
                quotesByCategory={sheet.quotesByCategory}
                quotesLoading={sheet.quotesLoading}
                isSelectedQuoteExpired={sheet.isSelectedQuoteExpired}
                onOpenFareDetails={() => sheet.setFareSheetVisible(true)}
              />

              <PaymentCouponBar
                paymentMode={sheet.paymentMode}
                walletBalancePaise={walletBalancePaise}
                selectedCoupon={sheet.selectedCoupon}
                activeCouponCode={sheet.activeCouponCode}
                activeOffers={sheet.activeOffers}
                couponError={sheet.couponError}
                onCyclePaymentMode={sheet.cyclePaymentMode}
                onToggleCoupon={sheet.toggleCoupon}
                onSelectCoupon={sheet.selectCoupon}
                onApplyCouponCode={sheet.applyCouponCode}
                onClearCoupon={sheet.clearCoupon}
              />

              <View style={styles.ctaContainer}>
                <AppButton
                  title={sheet.ctaTitle}
                  disabled={!sheet.canProceed && !sheet.isSelectedQuoteExpired}
                  onPress={sheet.startBooking}
                />
              </View>
            </ScrollView>
          )}
        </View>
      </View>

      <FareEstimateSheet
        visible={sheet.fareSheetVisible}
        quote={sheet.selectedQuote}
        categoryName={sheet.selectedCategory?.name}
        secondsUntilExpiry={sheet.secondsUntilExpiry}
        isExpired={sheet.isSelectedQuoteExpired}
        refreshing={sheet.refreshingQuote}
        onRefresh={sheet.refreshSelectedQuote}
        onClose={() => sheet.setFareSheetVisible(false)}
      />

      <LocationSearchModal
        visible={sheet.searchModalVisible}
        initialField={sheet.searchField}
        pickupPoint={sheet.pickupPoint}
        dropPoint={sheet.dropPoint}
        currentCoords={currentCoords}
        savedPlaces={sheet.savedPlaces}
        tripMode={sheet.tripMode}
        singleFieldMode={sheet.editingStopIndex !== null}
        onSelectPoint={sheet.handlePointSelected}
        onOpenMapPicker={(field) => {
          if (sheet.editingStopIndex !== null) {
            sheet.openStopPinModal(sheet.editingStopIndex);
          } else {
            sheet.openPinModal(field);
          }
        }}
        onClose={() => sheet.setSearchModalVisible(false)}
      />

      <PinAdjusterModal
        visible={sheet.pinModalVisible}
        field={sheet.pinField}
        initialCoords={pinInitialCoords}
        onConfirm={sheet.handlePointSelected}
        onClose={() => sheet.setPinModalVisible(false)}
      />
    </>
  );
};
