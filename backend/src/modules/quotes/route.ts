import type { LatLng, MapsProvider } from '../../providers';

/** Road distance and time of a trip that passes through every point in order (pickup, stops, drop). */
export async function routeThrough(
  maps: MapsProvider,
  points: LatLng[],
): Promise<{ distanceMeters: number; durationSeconds: number }> {
  const legs = await Promise.all(points.slice(1).map((p, i) => maps.route(points[i]!, p)));
  return {
    distanceMeters: legs.reduce((sum, l) => sum + l.distanceMeters, 0),
    durationSeconds: legs.reduce((sum, l) => sum + l.durationSeconds, 0),
  };
}
