import { z } from 'zod';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const point = z.object({ lat, lng }).strict();

/** Groups the keystrokes of one search so the maps provider bills them as one. Made by the app. */
const sessionToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, '8-64 letters, digits, - or _')
  .optional();

export const autocompleteSchema = z
  .object({
    input: z.string().trim().min(1).max(200),
    sessionToken,
    // Where the user is, so nearby places come first.
    near: point.optional(),
  })
  .strict();

export const placeSchema = z
  .object({
    // From an autocomplete suggestion.
    placeId: z.string().regex(/^[A-Za-z0-9_-]{1,300}$/, 'Not a valid place id'),
    sessionToken,
  })
  .strict();

export const reverseGeocodeSchema = point;

export const routeEstimateSchema = z.object({ origin: point, destination: point }).strict();
