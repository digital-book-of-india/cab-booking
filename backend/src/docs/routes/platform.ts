import type { RouteDoc } from '../routes';

/**
 * Platform routes added by Dev 1: location search and route preview, local file links, rider cash
 * confirmation and the alert test. Kept apart from productRoutes (Dev 2) so the two lists never collide.
 */
export const platformRoutes: RouteDoc[] = [
  {
    method: 'post',
    path: '/locations/autocomplete',
    tag: 'Locations',
    summary:
      'Address suggestions while the rider or driver types. Send the same sessionToken (any 8-64 character id the app makes) for every keystroke of one search and for the place lookup that follows, so the search is billed once. near (the position of the user) puts close places first. Each suggestion has a placeId; send it to POST /locations/place to get coordinates. Limited per user per minute',
    auth: ['CUSTOMER', 'DRIVER'],
    body: {
      input: 'connaught pl',
      sessionToken: 'search-0001-abcdef',
      near: { lat: 28.6315, lng: 77.2167 },
    },
  },
  {
    method: 'post',
    path: '/locations/place',
    tag: 'Locations',
    summary:
      'The coordinates and address of a suggestion the user picked (from POST /locations/autocomplete). 404 if the place is unknown. Use the returned point as the pickup or drop of a fare quote',
    auth: ['CUSTOMER', 'DRIVER'],
    body: { placeId: 'ChIJxxxxxxxx', sessionToken: 'search-0001-abcdef' },
  },
  {
    method: 'post',
    path: '/locations/reverse-geocode',
    tag: 'Locations',
    summary:
      'Names a spot on the map (the pin the user dropped). address is null when nothing is known there',
    auth: ['CUSTOMER', 'DRIVER'],
    body: { lat: 28.6315, lng: 77.2167 },
  },
  {
    method: 'post',
    path: '/routes/estimate',
    tag: 'Locations',
    summary:
      'A route preview: road distance, time and the path (polyline in Google encoded format, null if unavailable). For drawing the trip on a map only. The price of a trip always comes from POST /fare-quotes, never from here',
    auth: ['CUSTOMER', 'DRIVER'],
    body: { origin: { lat: 28.6315, lng: 77.2167 }, destination: { lat: 28.5562, lng: 77.1 } },
  },
  {
    method: 'put',
    path: '/files/upload',
    tag: 'Files',
    summary:
      'Send a file to the signed link returned by POST /drivers/me/documents (server upload folder). Send the file bytes as the body with the same Content-Type that was declared. The link works for 10 minutes; the file must be a real JPEG, PNG or PDF within the size limit. No login token is needed: the link is the permission',
    auth: 'public',
    query: {
      key: 'from the link',
      ct: 'from the link',
      exp: 'from the link',
      sig: 'from the link',
    },
  },
  {
    method: 'get',
    path: '/files/download',
    tag: 'Files',
    summary:
      'Download a file through a signed link (for example the one staff get when they open a driver document). The link works for 5 minutes. The file is always sent as a download, never shown as a page',
    auth: 'public',
    query: { key: 'from the link', exp: 'from the link', sig: 'from the link' },
  },
  {
    method: 'post',
    path: '/rides/{rideId}/cash-collection/customer-confirm',
    tag: 'Payments',
    summary:
      'The rider says how much cash they handed to the driver (optional). It never moves money: the driver confirming the exact fare is what settles the ride. If the amount differs from the fare it is recorded as a cash dispute and audited for staff. Repeating the same amount is fine; a different amount afterwards is refused (409). Cash rides only, after the ride is completed, within 7 days',
    auth: ['CUSTOMER'],
    body: { amountPaise: 25000 },
  },
  {
    method: 'post',
    path: '/admin/system/test-alert',
    tag: 'Operations',
    summary:
      'Sends a harmless TEST ALERT through the real alert path (the log and, if ALERT_WEBHOOK_URL is set, the Slack/Discord webhook). Answers webhookConfigured and delivered (true only if the webhook accepted it). Use it after setting the webhook, and after any change to it. Audited',
    auth: ['OPS', 'SUPER_ADMIN'],
  },
];
