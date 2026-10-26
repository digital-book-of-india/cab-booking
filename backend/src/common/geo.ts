export type GeoPoint = { type: 'Point'; coordinates: [number, number] };

/** API uses {lat, lng}; the database stores GeoJSON [lng, lat]. */
export function toPoint(lat: number, lng: number): GeoPoint {
  return { type: 'Point', coordinates: [lng, lat] };
}

export function fromPoint(p: { coordinates: number[] }): { lat: number; lng: number } {
  return { lat: p.coordinates[1] as number, lng: p.coordinates[0] as number };
}

/** Round integer paise to the nearest whole rupee (100 paise). */
export function roundToRupee(paise: number): number {
  return Math.round(paise / 100) * 100;
}

/** Great-circle distance in metres. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Google "encoded polyline" (precision 5) of a list of points. */
export function encodePolyline(points: { lat: number; lng: number }[]): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const chunk = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    chunk(lat - prevLat);
    chunk(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}
