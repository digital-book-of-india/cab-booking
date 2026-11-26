import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { ApiError, apiRequest } from '../services/api';
import { CustomerService } from '../services/customer.service';
import { LocationService } from '../services/location.service';
import { MAX_QUOTE_STOPS, QuotesService } from '../services/quotes.service';
import type { SavedPlace } from '../types/customer.types';
import type {
  CabCategory,
  LocationPoint,
  OutstationOptionItem,
  RentalPackageItem,
  ServiceabilityResponse,
  TripMode,
} from '../types/location.types';
import type { OutstationTripType } from '../types/quotes.types';
import { useFareQuotes } from './useFareQuotes';
import { useRouteEstimate } from './useRouteEstimate';

export type RideCoupon = {
  id: string;
  code: string;
  title?: string;
  description?: string;
  type?: 'PERCENT' | 'FLAT';
  value?: number;
  maxDiscountPaise?: number | null;
  minFarePaise?: number;
  icon?: string;
  badgeColor?: string;
  badgeBg?: string;
};

export type DisplayCategory = {
  id: string;
  code: string;
  name: string;
  capacity: number;
  available: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  desc: string;
  tag?: string;
};

export type BookingStep = 'SELECT' | 'CONFIRMING' | 'CONFIRMED';
export type PaymentMode = 'WALLET' | 'CASH' | 'UPI';

const CATEGORY_META_BY_CODE: Record<
  string,
  { icon: keyof typeof Ionicons.glyphMap; desc: string; tag?: string }
> = {
  MINI: { icon: 'car-sport', desc: 'Compact everyday city rides', tag: 'Popular' },
  SEDAN: { icon: 'car', desc: 'Comfortable sedans & extra legroom' },
  SUV: { icon: 'car-outline', desc: 'Spacious rides for groups & luggage' },
};

const LEGACY_SERVICE_TO_CODE: Record<string, string> = {
  cab_go: 'MINI',
  cab_premier: 'SEDAN',
  cab_suv: 'SUV',
  cab_auto: 'MINI',
  cab_moto: 'MINI',
  cab_rentals: 'MINI',
};

export type UseRideBookingSheetParams = {
  visible: boolean;
  initialServiceId?: string;
  initialPickup?: LocationPoint | null;
  initialDrop?: LocationPoint | null;
  initialZoneServiceability?: ServiceabilityResponse | null;
  initialTripMode?: TripMode;
  onClose: () => void;
};

export function useRideBookingSheet({
  visible,
  initialServiceId = 'MINI',
  initialPickup = null,
  initialDrop = null,
  initialZoneServiceability = null,
  initialTripMode = 'CITY',
  onClose,
}: UseRideBookingSheetParams) {
  const { isAuthenticated } = useAuth();
  const [pickupPoint, setPickupPoint] = useState<LocationPoint | null>(initialPickup);
  const [dropPoint, setDropPoint] = useState<LocationPoint | null>(initialDrop);
  const [stops, setStops] = useState<LocationPoint[]>([]);
  const [activeField, setActiveField] = useState<'pickup' | 'drop'>(
    initialPickup ? 'drop' : 'pickup',
  );
  const [tripMode, setTripMode] = useState<TripMode>(initialTripMode);

  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchField, setSearchField] = useState<'pickup' | 'drop'>('drop');
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinField, setPinField] = useState<'pickup' | 'drop'>('pickup');
  const [editingStopIndex, setEditingStopIndex] = useState<number | null>(null);

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [cabCategories, setCabCategories] = useState<CabCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  const [serviceabilityState, setServiceabilityState] = useState<{
    key: string;
    result: ServiceabilityResponse | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [tripModeState, setTripModeState] = useState<{
    key: string;
    rentalPackages: RentalPackageItem[] | null;
    outstationOptions: OutstationOptionItem[] | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [selectedRentalPackageId, setSelectedRentalPackageId] = useState<string | null>(null);
  const [outstationTripType, setOutstationTripType] =
    useState<OutstationTripType>('ONE_WAY');
  const [outstationReturnAt, setOutstationReturnAt] = useState<Date | null>(null);
  const [scheduledFor, setScheduledFor] = useState<Date | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('WALLET');
  const [bookingStep, setBookingStep] = useState<BookingStep>('SELECT');
  const [activeOffers, setActiveOffers] = useState<RideCoupon[]>([]);
  const [selectedCoupon, setSelectedCoupon] = useState<RideCoupon | null>(null);
  const [manualCouponCode, setManualCouponCode] = useState<string | null>(null);
  const [fareSheetVisible, setFareSheetVisible] = useState(false);

  const { routeEstimate, routeLoading, routeError } = useRouteEstimate({
    enabled: visible,
    pickupPoint,
    dropPoint,
    tripMode,
    reloadTick,
  });

  // Fetch public cab categories and saved places on open
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();

    LocationService.getCabCategories(controller.signal)
      .then((cats) => {
        if (!controller.signal.aborted) setCabCategories(cats);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCabCategories([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCategoriesLoading(false);
      });

    if (isAuthenticated) {
      CustomerService.listSavedPlaces()
        .then((places) => {
          if (!controller.signal.aborted) setSavedPlaces(places);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSavedPlaces([]);
        });
    }

    return () => controller.abort();
  }, [visible, isAuthenticated]);

  const effectiveSavedPlaces = useMemo(
    () => (isAuthenticated ? savedPlaces : []),
    [isAuthenticated, savedPlaces],
  );

  const serviceabilityKey =
    visible && pickupPoint
      ? `${pickupPoint.lat},${pickupPoint.lng}>${
          tripMode === 'RENTAL' || !dropPoint
            ? `${pickupPoint.lat},${pickupPoint.lng}`
            : `${dropPoint.lat},${dropPoint.lng}`
        }:${tripMode}:${reloadTick}`
      : null;

  // Check two-point serviceability whenever pickup, drop, or tripMode changes
  useEffect(() => {
    if (!serviceabilityKey || !pickupPoint) return;

    const controller = new AbortController();
    const effectiveDrop = tripMode === 'RENTAL' || !dropPoint ? pickupPoint : dropPoint;

    LocationService.checkServiceability(pickupPoint, effectiveDrop, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setServiceabilityState({
            key: serviceabilityKey,
            result: res,
            loading: false,
            error: null,
          });
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setServiceabilityState({
            key: serviceabilityKey,
            result: null,
            loading: false,
            error:
              err instanceof Error
                ? err.message
                : 'Could not verify route serviceability.',
          });
        }
      });

    return () => controller.abort();
  }, [serviceabilityKey, pickupPoint, dropPoint, tripMode]);

  const activeServiceability =
    serviceabilityKey && serviceabilityState?.key === serviceabilityKey
      ? serviceabilityState
      : null;
  const serviceabilityResult =
    activeServiceability?.result ??
    (pickupPoint ? initialZoneServiceability : null);
  const checkingServiceability = serviceabilityKey
    ? activeServiceability
      ? activeServiceability.loading
      : true
    : false;
  const serviceabilityError = activeServiceability?.error ?? null;

  const pickupZoneId = serviceabilityResult?.pickup.serviceable
    ? serviceabilityResult.pickup.zoneId
    : undefined;

  // Fetch zone-eligible active coupons for the rider
  useEffect(() => {
    if (!visible || !isAuthenticated) return;
    const controller = new AbortController();
    const query = pickupZoneId ? `?zoneId=${encodeURIComponent(pickupZoneId)}` : '';

    apiRequest<RideCoupon[] | { items?: RideCoupon[] }>(`coupons/active${query}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted) return;
        const list = Array.isArray(res) ? res : res?.items || [];
        setActiveOffers(list);
      })
      .catch(() => {
        if (!controller.signal.aborted) setActiveOffers([]);
      });

    return () => controller.abort();
  }, [visible, isAuthenticated, pickupZoneId]);

  const effectiveActiveOffers = useMemo(
    () => (visible && isAuthenticated ? activeOffers : []),
    [visible, isAuthenticated, activeOffers],
  );

  const tripModeKey =
    visible && pickupPoint && tripMode !== 'CITY'
      ? `${pickupPoint.lat},${pickupPoint.lng}:${tripMode}:${reloadTick}`
      : null;

  // Zone-aware rental packages / outstation options check
  useEffect(() => {
    if (!tripModeKey || !pickupPoint || tripMode === 'CITY') return;

    const controller = new AbortController();

    const formatTripError = (err: unknown, fallback: string, unauthMsg: string) => {
      if (err instanceof ApiError && err.status === 401) return unauthMsg;
      return err instanceof Error ? err.message : fallback;
    };

    if (tripMode === 'RENTAL') {
      LocationService.getRentalPackagesNear(pickupPoint, undefined, controller.signal)
        .then((res) => {
          if (!controller.signal.aborted) {
            setTripModeState({
              key: tripModeKey,
              rentalPackages: res.packages,
              outstationOptions: null,
              loading: false,
              error: null,
            });
            setSelectedRentalPackageId((prev) =>
              prev && res.packages.some((p) => p.packageId === prev)
                ? prev
                : res.packages[0]?.packageId ?? null,
            );
          }
        })
        .catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          if (!controller.signal.aborted) {
            setTripModeState({
              key: tripModeKey,
              rentalPackages: [],
              outstationOptions: null,
              loading: false,
              error: formatTripError(
                err,
                'Could not load rental packages for this zone.',
                'Sign in to check hourly rental availability in this zone.',
              ),
            });
            setSelectedRentalPackageId(null);
          }
        });
    } else {
      LocationService.getOutstationOptions(pickupPoint, controller.signal)
        .then((res) => {
          if (!controller.signal.aborted) {
            setTripModeState({
              key: tripModeKey,
              rentalPackages: null,
              outstationOptions: res.options,
              loading: false,
              error: null,
            });
            setSelectedRentalPackageId(null);
          }
        })
        .catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          if (!controller.signal.aborted) {
            setTripModeState({
              key: tripModeKey,
              rentalPackages: null,
              outstationOptions: [],
              loading: false,
              error: formatTripError(
                err,
                'Could not load outstation options for this zone.',
                'Sign in to check outstation availability in this zone.',
              ),
            });
          }
        });
    }

    return () => controller.abort();
  }, [tripModeKey, pickupPoint, tripMode]);

  const activeTripModeState =
    tripModeKey && tripModeState?.key === tripModeKey ? tripModeState : null;
  const rentalPackages =
    tripMode === 'RENTAL' ? activeTripModeState?.rentalPackages ?? null : null;
  const outstationOptions =
    tripMode === 'OUTSTATION'
      ? activeTripModeState?.outstationOptions ?? null
      : null;
  const tripModeLoading = tripModeKey
    ? activeTripModeState
      ? activeTripModeState.loading
      : true
    : false;
  const tripModeError = activeTripModeState?.error ?? null;

  // Merge catalog categories with pickup-zone availability
  const displayCategories = useMemo<DisplayCategory[]>(() => {
    const zoneCats = serviceabilityResult?.categories ?? [];
    const zoneCatMap = new Map(zoneCats.map((c) => [c.categoryId, c]));
    const pickupServiceable = serviceabilityResult?.pickup.serviceable;

    if (cabCategories.length > 0) {
      return cabCategories.map((cat) => {
        const meta = CATEGORY_META_BY_CODE[cat.code] ?? {
          icon: 'car' as const,
          desc: `${cat.capacity} seats`,
        };
        const zoneEntry = zoneCatMap.get(cat.id);
        const available = serviceabilityResult
          ? Boolean(pickupServiceable && zoneEntry?.available)
          : true;

        return {
          id: cat.id,
          code: cat.code,
          name: cat.name,
          capacity: cat.capacity,
          available,
          icon: meta.icon,
          desc: `${cat.capacity} seats • ${meta.desc}`,
          tag: meta.tag,
        };
      });
    }

    return zoneCats.map((cat) => {
      const meta = CATEGORY_META_BY_CODE[cat.code] ?? {
        icon: 'car' as const,
        desc: 'City cab',
      };
      return {
        id: cat.categoryId,
        code: cat.code,
        name: cat.name,
        capacity: 4,
        available: Boolean(pickupServiceable && cat.available),
        icon: meta.icon,
        desc: meta.desc,
        tag: meta.tag,
      };
    });
  }, [cabCategories, serviceabilityResult]);

  const selectedRentalPackage = useMemo(
    () =>
      rentalPackages?.find((p) => p.packageId === selectedRentalPackageId) ??
      null,
    [rentalPackages, selectedRentalPackageId],
  );

  // Derive valid selectedCategoryId without calling setState inside an effect
  const effectiveSelectedCategoryId = useMemo(() => {
    if (tripMode === 'RENTAL' && selectedRentalPackage) {
      return selectedRentalPackage.categoryId;
    }
    if (displayCategories.length === 0) return selectedCategoryId;

    const current = displayCategories.find((c) => c.id === selectedCategoryId);
    if (current && current.available) return current.id;

    const targetCode =
      LEGACY_SERVICE_TO_CODE[initialServiceId] ?? initialServiceId.toUpperCase();
    const preferred = displayCategories.find(
      (c) => c.available && (c.id === initialServiceId || c.code === targetCode),
    );
    const firstAvailable = displayCategories.find((c) => c.available);
    return (preferred ?? firstAvailable ?? displayCategories[0]).id;
  }, [
    displayCategories,
    selectedCategoryId,
    initialServiceId,
    tripMode,
    selectedRentalPackage,
  ]);

  const selectedCategory =
    displayCategories.find((c) => c.id === effectiveSelectedCategoryId) ?? null;

  const activeCouponCode = manualCouponCode ?? selectedCoupon?.code ?? null;

  const {
    quotesByCategory,
    selectedQuote,
    quotesLoading,
    refreshingQuote,
    quoteError,
    couponError,
    secondsUntilExpiry,
    isSelectedQuoteExpired,
    refreshSelectedQuote,
    recalculateQuotes,
  } = useFareQuotes({
    enabled: visible && bookingStep === 'SELECT',
    isAuthenticated,
    pickupPoint,
    dropPoint,
    stops,
    tripMode,
    categories: displayCategories,
    selectedCategoryId: effectiveSelectedCategoryId,
    paymentMode,
    couponCode: activeCouponCode,
    scheduledFor,
    selectedRentalPackage,
    outstationOptions,
    outstationTripType,
    outstationReturnAt,
    serviceabilityResult,
    checkingServiceability,
    tripModeLoading,
    routeError,
    reloadTick,
  });

  const quickLocations = useMemo<LocationPoint[]>(() => {
    return effectiveSavedPlaces.map((p) => ({
      label: p.name ? `${p.name} (${p.address})` : p.address,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
    }));
  }, [effectiveSavedPlaces]);

  const handlePointSelected = (field: 'pickup' | 'drop', point: LocationPoint) => {
    if (editingStopIndex !== null) {
      setStops((prev) => {
        const next = [...prev];
        if (editingStopIndex < next.length) {
          next[editingStopIndex] = point;
        } else if (next.length < MAX_QUOTE_STOPS) {
          next.push(point);
        }
        return next;
      });
      setEditingStopIndex(null);
      return;
    }

    setActiveField(field);
    if (field === 'pickup') {
      setPickupPoint(point);
      if (!dropPoint && tripMode !== 'RENTAL') {
        setActiveField('drop');
      }
    } else {
      setDropPoint(point);
    }
  };

  const selectQuickLocation = (point: LocationPoint) => {
    setEditingStopIndex(null);
    handlePointSelected(activeField, point);
  };

  const openSearchModal = (field: 'pickup' | 'drop') => {
    setEditingStopIndex(null);
    setActiveField(field);
    setSearchField(field);
    setSearchModalVisible(true);
  };

  const openPinModal = (field: 'pickup' | 'drop') => {
    setEditingStopIndex(null);
    setActiveField(field);
    setPinField(field);
    setPinModalVisible(true);
  };

  const openStopSearchModal = (stopIndex: number) => {
    if (stopIndex >= MAX_QUOTE_STOPS) return;
    setEditingStopIndex(stopIndex);
    setSearchField('drop');
    setSearchModalVisible(true);
  };

  const openStopPinModal = (stopIndex: number) => {
    if (stopIndex >= MAX_QUOTE_STOPS) return;
    setEditingStopIndex(stopIndex);
    setPinField('drop');
    setPinModalVisible(true);
  };

  const removeStop = (stopIndex: number) => {
    setStops((prev) => prev.filter((_, i) => i !== stopIndex));
  };

  const changeTripMode = (mode: TripMode) => {
    setTripMode(mode);
    setFareSheetVisible(false);
    if (mode !== 'CITY') {
      setStops([]);
    }
    if (mode === 'RENTAL') {
      setActiveField('pickup');
    } else if (!dropPoint) {
      setActiveField('drop');
    }
  };

  const toggleCoupon = () => {
    if (effectiveActiveOffers.length === 0) {
      Alert.alert('Offers', 'No active offers available right now.');
      return;
    }
    setManualCouponCode(null);
    if (!selectedCoupon) {
      setSelectedCoupon(effectiveActiveOffers[0]);
      return;
    }
    const currentIndex = effectiveActiveOffers.findIndex(
      (o) => o.code === selectedCoupon.code,
    );
    const nextIndex = (currentIndex + 1) % (effectiveActiveOffers.length + 1);
    setSelectedCoupon(
      nextIndex === effectiveActiveOffers.length
        ? null
        : effectiveActiveOffers[nextIndex],
    );
  };

  const selectCoupon = (coupon: RideCoupon | null) => {
    setManualCouponCode(null);
    setSelectedCoupon(coupon);
  };

  const applyCouponCode = (code: string) => {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    const matched =
      effectiveActiveOffers.find((o) => o.code.toUpperCase() === normalized) ??
      null;
    if (matched) {
      setSelectedCoupon(matched);
      setManualCouponCode(null);
    } else {
      setSelectedCoupon(null);
      setManualCouponCode(normalized);
    }
  };

  const clearCoupon = () => {
    setSelectedCoupon(null);
    setManualCouponCode(null);
  };

  const cyclePaymentMode = () => {
    setPaymentMode((prev) =>
      prev === 'WALLET' ? 'CASH' : prev === 'CASH' ? 'UPI' : 'WALLET',
    );
  };

  const startBooking = async () => {
    if (!selectedQuote || isSelectedQuoteExpired) {
      await refreshSelectedQuote();
      return;
    }
    setBookingStep('CONFIRMING');
    setTimeout(() => {
      setBookingStep('CONFIRMED');
    }, 1800);
  };

  const finishBooking = () => {
    setBookingStep('SELECT');
    onClose();
    router.push('/(app)/rides');
  };

  const closeModal = () => {
    setBookingStep('SELECT');
    setFareSheetVisible(false);
    onClose();
  };

  const pickupSide = serviceabilityResult?.pickup;
  const dropSide = serviceabilityResult?.drop;
  const isPickupServiceable = pickupSide?.serviceable === true;
  const isDropServiceable = tripMode === 'RENTAL' ? true : dropSide?.serviceable === true;

  const isTripModeUnavailable =
    (tripMode === 'RENTAL' && rentalPackages !== null && rentalPackages.length === 0) ||
    (tripMode === 'OUTSTATION' &&
      outstationOptions !== null &&
      outstationOptions.length === 0);

  const needsRentalPackage = tripMode === 'RENTAL' && !selectedRentalPackage;
  const needsOutstationReturn =
    tripMode === 'OUTSTATION' &&
    outstationTripType === 'ROUND_TRIP' &&
    !outstationReturnAt;

  const canProceed =
    !checkingServiceability &&
    !tripModeLoading &&
    !routeLoading &&
    !quotesLoading &&
    !refreshingQuote &&
    !serviceabilityError &&
    !routeError &&
    !quoteError &&
    pickupPoint !== null &&
    (tripMode === 'RENTAL' || dropPoint !== null) &&
    isPickupServiceable &&
    isDropServiceable &&
    Boolean(selectedCategory?.available) &&
    !isTripModeUnavailable &&
    !needsRentalPackage &&
    !needsOutstationReturn &&
    Boolean(selectedQuote) &&
    !isSelectedQuoteExpired;

  let ctaTitle = `Continue with ${selectedCategory?.name ?? 'Ride'}`;
  if (!pickupPoint) ctaTitle = 'Select Pickup Location';
  else if (tripMode !== 'RENTAL' && !dropPoint) ctaTitle = 'Select Drop-off Location';
  else if (checkingServiceability || tripModeLoading || routeLoading) {
    ctaTitle = 'Checking Availability...';
  } else if (routeError) ctaTitle = 'Route Unavailable';
  else if (serviceabilityError) ctaTitle = 'Unable to Verify Zone';
  else if (!isPickupServiceable || !isDropServiceable || isTripModeUnavailable) {
    ctaTitle = 'Area Not Serviceable';
  } else if (!selectedCategory || !selectedCategory.available) {
    ctaTitle = 'No Cabs Available in Zone';
  } else if (needsRentalPackage) {
    ctaTitle = 'Select a Rental Package';
  } else if (needsOutstationReturn) {
    ctaTitle = 'Select Return Date & Time';
  } else if (!isAuthenticated) {
    ctaTitle = 'Sign in to Get Fare Quote';
  } else if (quotesLoading || refreshingQuote) {
    ctaTitle = 'Calculating Fare...';
  } else if (quoteError) {
    ctaTitle = 'Fare Unavailable';
  } else if (isSelectedQuoteExpired) {
    ctaTitle = 'Quote Expired — Tap to Refresh';
  } else if (selectedQuote) {
    ctaTitle = `Book ${selectedCategory.name} • ${QuotesService.formatPaise(
      selectedQuote.estimatedPayablePaise,
      selectedQuote.currency,
    )}`;
  }

  return {
    pickupPoint,
    dropPoint,
    stops,
    activeField,
    setActiveField,
    tripMode,
    setTripMode: changeTripMode,
    savedPlaces: effectiveSavedPlaces,
    searchModalVisible,
    setSearchModalVisible,
    searchField,
    pinModalVisible,
    setPinModalVisible,
    pinField,
    editingStopIndex,
    openSearchModal,
    openPinModal,
    openStopSearchModal,
    openStopPinModal,
    removeStop,
    handlePointSelected,
    routeEstimate,
    routeLoading,
    routeError,
    categoriesLoading,
    serviceabilityResult,
    checkingServiceability,
    serviceabilityError,
    rentalPackages,
    selectedRentalPackageId,
    setSelectedRentalPackageId,
    selectedRentalPackage,
    outstationOptions,
    outstationTripType,
    setOutstationTripType,
    outstationReturnAt,
    setOutstationReturnAt,
    scheduledFor,
    setScheduledFor,
    tripModeLoading,
    tripModeError,
    displayCategories,
    selectedCategory,
    setSelectedCategoryId,
    quotesByCategory,
    selectedQuote,
    quotesLoading,
    refreshingQuote,
    quoteError,
    couponError,
    secondsUntilExpiry,
    isSelectedQuoteExpired,
    refreshSelectedQuote,
    recalculateQuotes,
    fareSheetVisible,
    setFareSheetVisible,
    quickLocations,
    selectQuickLocation,
    paymentMode,
    cyclePaymentMode,
    activeOffers: effectiveActiveOffers,
    selectedCoupon,
    activeCouponCode,
    selectCoupon,
    applyCouponCode,
    clearCoupon,
    toggleCoupon,
    bookingStep,
    startBooking,
    finishBooking,
    closeModal,
    retryServiceability: () => {
      setReloadTick((t) => t + 1);
      recalculateQuotes();
    },
    canProceed,
    ctaTitle,
    zoneName: pickupSide?.serviceable ? pickupSide.zoneName : undefined,
  };
}
