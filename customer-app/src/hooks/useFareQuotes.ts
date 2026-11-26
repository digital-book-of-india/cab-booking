import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QuotesService } from '../services/quotes.service';
import type {
  LocationPoint,
  OutstationOptionItem,
  RentalPackageItem,
  ServiceabilityResponse,
  TripMode,
} from '../types/location.types';
import type {
  CreateQuoteInput,
  FareQuote,
  OutstationTripType,
} from '../types/quotes.types';

export type QuoteEligibleCategory = {
  id: string;
  available: boolean;
};

export type UseFareQuotesParams = {
  enabled: boolean;
  isAuthenticated: boolean;
  pickupPoint: LocationPoint | null;
  dropPoint: LocationPoint | null;
  stops: LocationPoint[];
  tripMode: TripMode;
  categories: QuoteEligibleCategory[];
  selectedCategoryId: string;
  paymentMode: 'WALLET' | 'CASH' | 'UPI';
  couponCode: string | null;
  scheduledFor: Date | null;
  selectedRentalPackage: RentalPackageItem | null;
  outstationOptions: OutstationOptionItem[] | null;
  outstationTripType: OutstationTripType;
  outstationReturnAt: Date | null;
  serviceabilityResult: ServiceabilityResponse | null;
  checkingServiceability: boolean;
  tripModeLoading: boolean;
  routeError: string | null;
  reloadTick?: number;
};

type QuoteBatchState = {
  key: string;
  loading: boolean;
  quotesByCategory: Record<string, FareQuote>;
  couponErrorsByCategory: Record<string, string>;
  categoryErrors: Record<string, string>;
  globalError: string | null;
};

const QUOTE_DEBOUNCE_MS = 320;
const EMPTY_QUOTES: Record<string, FareQuote> = {};

export function useFareQuotes({
  enabled,
  isAuthenticated,
  pickupPoint,
  dropPoint,
  stops,
  tripMode,
  categories,
  selectedCategoryId,
  paymentMode,
  couponCode,
  scheduledFor,
  selectedRentalPackage,
  outstationOptions,
  outstationTripType,
  outstationReturnAt,
  serviceabilityResult,
  checkingServiceability,
  tripModeLoading,
  routeError,
  reloadTick = 0,
}: UseFareQuotesParams) {
  const [state, setState] = useState<QuoteBatchState | null>(null);
  const [refreshingQuote, setRefreshingQuote] = useState(false);
  const [manualTick, setManualTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const abortRef = useRef<AbortController | null>(null);

  const pickupServiceable = serviceabilityResult?.pickup.serviceable === true;
  const dropServiceable =
    tripMode === 'RENTAL'
      ? true
      : serviceabilityResult?.drop.serviceable === true;

  // Categories eligible for quoting in the current trip mode
  const targetCategoryIds = useMemo(() => {
    if (tripMode === 'RENTAL') {
      if (!selectedRentalPackage) return [];
      const cat = categories.find(
        (c) => c.id === selectedRentalPackage.categoryId && c.available,
      );
      return cat ? [cat.id] : [selectedRentalPackage.categoryId];
    }

    if (tripMode === 'OUTSTATION') {
      if (!outstationOptions || outstationOptions.length === 0) return [];
      const optionCatIds = new Set(outstationOptions.map((o) => o.categoryId));
      return categories
        .filter((c) => c.available && optionCatIds.has(c.id))
        .map((c) => c.id);
    }

    return categories.filter((c) => c.available).map((c) => c.id);
  }, [tripMode, selectedRentalPackage, outstationOptions, categories]);

  const hasValidTripInputs = useMemo(() => {
    if (!pickupPoint) return false;
    if (tripMode === 'RENTAL') {
      return Boolean(selectedRentalPackage);
    }
    if (!dropPoint) return false;
    if (tripMode === 'OUTSTATION' && outstationTripType === 'ROUND_TRIP') {
      return Boolean(outstationReturnAt);
    }
    return true;
  }, [
    pickupPoint,
    dropPoint,
    tripMode,
    selectedRentalPackage,
    outstationTripType,
    outstationReturnAt,
  ]);

  const canQuote =
    enabled &&
    isAuthenticated &&
    !checkingServiceability &&
    !tripModeLoading &&
    !routeError &&
    pickupServiceable &&
    dropServiceable &&
    hasValidTripInputs &&
    targetCategoryIds.length > 0;

  const stopsKey = useMemo(
    () => stops.map((s) => `${s.lat},${s.lng}`).join('|'),
    [stops],
  );

  const requestKey = useMemo(() => {
    if (!canQuote || !pickupPoint) return null;
    return JSON.stringify({
      p: [pickupPoint.lat, pickupPoint.lng],
      d: dropPoint ? [dropPoint.lat, dropPoint.lng] : null,
      s: tripMode === 'CITY' ? stopsKey : '',
      m: tripMode,
      cats: targetCategoryIds,
      pay: paymentMode,
      c: couponCode?.trim() || null,
      sf: scheduledFor ? scheduledFor.toISOString() : null,
      rp: tripMode === 'RENTAL' ? selectedRentalPackage?.packageId ?? null : null,
      ot: tripMode === 'OUTSTATION' ? outstationTripType : null,
      or:
        tripMode === 'OUTSTATION' &&
        outstationTripType === 'ROUND_TRIP' &&
        outstationReturnAt
          ? outstationReturnAt.toISOString()
          : null,
      rt: reloadTick,
      mt: manualTick,
    });
  }, [
    canQuote,
    pickupPoint,
    dropPoint,
    stopsKey,
    tripMode,
    targetCategoryIds,
    paymentMode,
    couponCode,
    scheduledFor,
    selectedRentalPackage?.packageId,
    outstationTripType,
    outstationReturnAt,
    reloadTick,
    manualTick,
  ]);

  const buildPayloadForCategory = useCallback(
    (categoryId: string, overrideCoupon?: string | null): CreateQuoteInput | null => {
      if (!pickupPoint) return null;
      const effectiveCoupon =
        overrideCoupon !== undefined ? overrideCoupon : couponCode?.trim() || null;

      const base: CreateQuoteInput = {
        pickup: QuotesService.toQuotePoint(pickupPoint),
        categoryId,
        paymentPreference: QuotesService.toPaymentPreference(paymentMode),
        ...(effectiveCoupon ? { couponCode: effectiveCoupon } : {}),
        ...(scheduledFor ? { scheduledFor: scheduledFor.toISOString() } : {}),
      };

      if (tripMode === 'RENTAL') {
        if (!selectedRentalPackage) return null;
        return {
          ...base,
          rentalPackageId: selectedRentalPackage.packageId,
        };
      }

      if (!dropPoint) return null;

      if (tripMode === 'OUTSTATION') {
        return {
          ...base,
          drop: QuotesService.toQuotePoint(dropPoint),
          outstation: {
            tripType: outstationTripType,
            ...(outstationTripType === 'ROUND_TRIP' && outstationReturnAt
              ? { returnAt: outstationReturnAt.toISOString() }
              : {}),
          },
        };
      }

      return {
        ...base,
        drop: QuotesService.toQuotePoint(dropPoint),
        ...(stops.length > 0
          ? { stops: stops.map(QuotesService.toQuotePoint) }
          : {}),
      };
    },
    [
      pickupPoint,
      dropPoint,
      stops,
      tripMode,
      paymentMode,
      couponCode,
      scheduledFor,
      selectedRentalPackage,
      outstationTripType,
      outstationReturnAt,
    ],
  );

  useEffect(() => {
    abortRef.current?.abort();
    if (!requestKey) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      if (controller.signal.aborted) return;

      setState((prev) => ({
        key: requestKey,
        loading: true,
        quotesByCategory: prev?.key === requestKey ? prev.quotesByCategory : {},
        couponErrorsByCategory: {},
        categoryErrors: {},
        globalError: null,
      }));

      const nextQuotes: Record<string, FareQuote> = {};
      const nextCouponErrors: Record<string, string> = {};
      const nextCategoryErrors: Record<string, string> = {};
      let firstGlobalError: string | null = null;

      await Promise.all(
        targetCategoryIds.map(async (catId) => {
          const payload = buildPayloadForCategory(catId);
          if (!payload) return;

          try {
            const quote = await QuotesService.createQuote(
              payload,
              controller.signal,
            );
            if (!controller.signal.aborted) {
              nextQuotes[catId] = quote;
            }
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            const parsed = QuotesService.parseError(err);

            // If coupon validation failed for this category (e.g. minFarePaise or wrong cab),
            // preserve the reason and still fetch the base quote without coupon so prices remain visible.
            if (parsed.isCouponError && payload.couponCode) {
              nextCouponErrors[catId] = parsed.message;
              const fallbackPayload = buildPayloadForCategory(catId, null);
              if (fallbackPayload) {
                try {
                  const baseQuote = await QuotesService.createQuote(
                    fallbackPayload,
                    controller.signal,
                  );
                  if (!controller.signal.aborted) {
                    nextQuotes[catId] = baseQuote;
                  }
                  return;
                } catch (fallbackErr) {
                  if (
                    fallbackErr instanceof Error &&
                    fallbackErr.name === 'AbortError'
                  ) {
                    return;
                  }
                  const fallbackParsed = QuotesService.parseError(fallbackErr);
                  nextCategoryErrors[catId] = fallbackParsed.message;
                  if (!firstGlobalError) firstGlobalError = fallbackParsed.message;
                  return;
                }
              }
            }

            nextCategoryErrors[catId] = parsed.message;
            if (!firstGlobalError) {
              firstGlobalError = parsed.message;
            }
          }
        }),
      );

      if (controller.signal.aborted) return;

      setState({
        key: requestKey,
        loading: false,
        quotesByCategory: nextQuotes,
        couponErrorsByCategory: nextCouponErrors,
        categoryErrors: nextCategoryErrors,
        globalError: Object.keys(nextQuotes).length === 0 ? firstGlobalError : null,
      });
      setNowMs(Date.now());
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, targetCategoryIds, buildPayloadForCategory]);

  const activeState = requestKey && state?.key === requestKey ? state : null;
  const quotesByCategory = activeState?.quotesByCategory ?? EMPTY_QUOTES;
  const quotesLoading = requestKey
    ? activeState
      ? activeState.loading
      : true
    : false;
  const selectedQuote = quotesByCategory[selectedCategoryId] ?? null;

  // Tick every second while an active quote is displayed so expiry countdown is live
  useEffect(() => {
    if (!enabled || !selectedQuote) return;
    const expiresAtMs = new Date(selectedQuote.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) return;

    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [enabled, selectedQuote]);

  const secondsUntilExpiry = useMemo(() => {
    if (!selectedQuote) return null;
    const expiresAtMs = new Date(selectedQuote.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) return null;
    return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  }, [selectedQuote, nowMs]);

  const isSelectedQuoteExpired =
    selectedQuote !== null &&
    (selectedQuote.status === 'EXPIRED' ||
      (secondsUntilExpiry !== null && secondsUntilExpiry <= 0));

  const authPromptError =
    !requestKey &&
    enabled &&
    !isAuthenticated &&
    pickupServiceable &&
    hasValidTripInputs
      ? 'Sign in to view live fare quotes.'
      : null;

  const selectedCategoryError = activeState?.categoryErrors[selectedCategoryId] ?? null;
  const selectedCouponError =
    activeState?.couponErrorsByCategory[selectedCategoryId] ?? null;

  const refreshSelectedQuote = useCallback(async (): Promise<FareQuote | null> => {
    if (!selectedCategoryId) return null;
    setRefreshingQuote(true);

    try {
      let refreshed: FareQuote | null = null;
      if (selectedQuote && selectedQuote.status !== 'USED') {
        try {
          refreshed = await QuotesService.refreshQuote(selectedQuote.quoteId);
        } catch (err) {
          const parsed = QuotesService.parseError(err);
          if (!parsed.isExpiredOrUsed) {
            throw err;
          }
        }
      }

      if (!refreshed) {
        const payload = buildPayloadForCategory(selectedCategoryId);
        if (!payload) return null;
        refreshed = await QuotesService.createQuote(payload);
      }

      if (requestKey) {
        setState((prev) => {
          const base: QuoteBatchState =
            prev && prev.key === requestKey
              ? prev
              : {
                  key: requestKey,
                  loading: false,
                  quotesByCategory: {},
                  couponErrorsByCategory: {},
                  categoryErrors: {},
                  globalError: null,
                };
          const nextCatErrors = { ...base.categoryErrors };
          delete nextCatErrors[selectedCategoryId];
          const nextCouponErrors = { ...base.couponErrorsByCategory };
          delete nextCouponErrors[selectedCategoryId];
          return {
            ...base,
            loading: false,
            quotesByCategory: {
              ...base.quotesByCategory,
              [selectedCategoryId]: refreshed!,
            },
            categoryErrors: nextCatErrors,
            couponErrorsByCategory: nextCouponErrors,
            globalError: null,
          };
        });
      }
      setNowMs(Date.now());
      return refreshed;
    } catch (err) {
      const parsed = QuotesService.parseError(err);
      if (requestKey) {
        setState((prev) => {
          const base: QuoteBatchState =
            prev && prev.key === requestKey
              ? prev
              : {
                  key: requestKey,
                  loading: false,
                  quotesByCategory: {},
                  couponErrorsByCategory: {},
                  categoryErrors: {},
                  globalError: null,
                };
          if (parsed.isCouponError && couponCode) {
            return {
              ...base,
              couponErrorsByCategory: {
                ...base.couponErrorsByCategory,
                [selectedCategoryId]: parsed.message,
              },
            };
          }
          return {
            ...base,
            categoryErrors: {
              ...base.categoryErrors,
              [selectedCategoryId]: parsed.message,
            },
          };
        });
      }
      return null;
    } finally {
      setRefreshingQuote(false);
    }
  }, [
    selectedCategoryId,
    selectedQuote,
    buildPayloadForCategory,
    requestKey,
    couponCode,
  ]);

  const recalculateQuotes = useCallback(() => {
    setManualTick((t) => t + 1);
  }, []);

  return {
    quotesByCategory,
    selectedQuote,
    quotesLoading,
    refreshingQuote,
    quoteError:
      selectedCategoryError ?? activeState?.globalError ?? authPromptError,
    couponError: selectedCouponError,
    secondsUntilExpiry,
    isSelectedQuoteExpired,
    refreshSelectedQuote,
    recalculateQuotes,
  };
}
