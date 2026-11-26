import { useCallback, useEffect, useRef, useState } from 'react';
import { LocationService } from '../services/location.service';
import type { LocationPoint, PlaceSuggestion } from '../types/location.types';
import type { Coordinates } from '../types/ride.types';

export type UseLocationSearchOptions = {
  near?: Coordinates | null;
  debounceMs?: number;
  minQueryLength?: number;
};

export function useLocationSearch({
  near = null,
  debounceMs = 350,
  minQueryLength = 2,
}: UseLocationSearchOptions = {}) {
  const [query, setQueryState] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingPlaceId, setResolvingPlaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionTokenRef = useRef<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const placeAbortRef = useRef<AbortController | null>(null);

  const ensureSessionToken = useCallback(() => {
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = LocationService.createSearchSessionToken();
    }
    return sessionTokenRef.current;
  }, []);

  const setQuery = useCallback(
    (nextQuery: string) => {
      setQueryState(nextQuery);
      if (nextQuery.trim().length < minQueryLength) {
        searchAbortRef.current?.abort();
        setSuggestions([]);
        setSearching(false);
        setError(null);
      }
    },
    [minQueryLength],
  );

  const resetSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    placeAbortRef.current?.abort();
    sessionTokenRef.current = null;
    setQueryState('');
    setSuggestions([]);
    setSearching(false);
    setResolvingPlaceId(null);
    setError(null);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < minQueryLength) {
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current?.abort();
    searchAbortRef.current = controller;

    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const token = ensureSessionToken();
        const results = await LocationService.autocompletePlaces(
          trimmed,
          {
            sessionToken: token,
            ...(near ? { near } : {}),
          },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setSuggestions(results);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setError(
            LocationService.getLocationApiErrorMessage(
              err,
              'Could not fetch address suggestions.',
            ),
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, near, debounceMs, minQueryLength, ensureSessionToken]);

  const selectSuggestion = useCallback(
    async (suggestion: PlaceSuggestion): Promise<LocationPoint | null> => {
      placeAbortRef.current?.abort();
      const controller = new AbortController();
      placeAbortRef.current = controller;

      setResolvingPlaceId(suggestion.placeId);
      setError(null);

      try {
        const token = ensureSessionToken();
        const details = await LocationService.getPlaceDetails(
          suggestion.placeId,
          token,
          controller.signal,
        );

        // Close this Google Places billing session once a place is resolved.
        sessionTokenRef.current = null;

        return {
          lat: details.point.lat,
          lng: details.point.lng,
          label: details.name || suggestion.mainText || details.address,
          address: details.address || suggestion.description,
          placeId: suggestion.placeId,
        };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return null;
        }
        setError(
          LocationService.getLocationApiErrorMessage(
            err,
            'Could not load coordinates for the selected place.',
          ),
        );
        return null;
      } finally {
        if (!controller.signal.aborted) {
          setResolvingPlaceId(null);
        }
      }
    },
    [ensureSessionToken],
  );

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      placeAbortRef.current?.abort();
    };
  }, []);

  return {
    query,
    setQuery,
    suggestions,
    searching,
    resolvingPlaceId,
    error,
    selectSuggestion,
    resetSearch,
  };
}
