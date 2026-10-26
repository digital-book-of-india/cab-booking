# Load test results

**How to read these numbers.** They come from `npm run loadtest:local` on one developer machine (Windows, Node 20): the server, an in-memory MongoDB and the load generator all share it. They show where the *application* struggles and let us compare before/after a change. They are **not** the capacity of a hosted server with a hosted database. Real capacity numbers need the same scripts run on staging (`npm run loadtest`, `npm run loadtest:rides`), which has not been done yet.

## Run of 2026-10-18

### Riders only (100 riders, 25 at a time, 3 rounds each, a live connection each)
- 1,401 requests, **0 errors**, all 100 sockets stayed connected; about 56 requests per second for the whole machine.
- Slowest at 25 at once (median / 95th percentile, ms): book 916 / 1187, sign-in verify 335 / 660, quote 286 / 562, cancel 378 / 540, read booking 133 / 216.
- A booking is the heaviest call (about 15 database operations: replay check, quote claim, policy and commission snapshots, booking, event, dispatch start). Under lighter load (second run) it was 104-143 ms median. The high numbers are one laptop running three busy processes, not a code defect; revisit on staging.

### Full rides (30 drivers, 15 riders, 45 seconds, every ride driven to completion)
| | Before the dispatch fix | After |
|---|---|---|
| Rides completed | 36 | 110 |
| Time for a rider to get a driver, median | 8 s | 2 s |
| Time to get a driver, 95th percentile | 36 s | 6 s |
| Slowest | 38 s | 8 s |
| Server errors | 0 of 3,536 | 0 of 3,223 |

Speed per call stayed low: location update 24 ms median, offers 35 ms, accept 59 ms.

## Run of 2026-10-23 (after Phase 1: tax, maps, locations, city-distance changes)

Same machine and method as 2026-10-18 (`npm run loadtest:local`, in-memory database, everything on one laptop). **Both runs: 0 server errors, readiness still 200 afterwards, no server warnings.**

### Same sizes as before (no regression)
| | 2026-10-18 | 2026-10-23 |
|---|---|---|
| Riders: requests / errors / sockets kept | 1,401 / 0 / 100 | 1,401 / 0 / 100 |
| Book, median / 95th (ms) | 916 / 1187 | 1019 / 1493 |
| Quote, median / 95th (ms) | 286 / 562 | 306 / 562 |
| Full rides completed (30 drivers, 15 riders, 45 s) | 110 | 98 |
| Time to get a driver, median / 95th / max (s) | 2 / 6 / 8 | 3 / 6 / 8 |

The differences are within run-to-run noise on a busy laptop. Nothing points at the Phase 1 changes.

### Bigger (200 riders at 40 at a time; 50 drivers, 30 riders, 60 s)
- Riders: 2,801 requests, 0 errors, 200 of 200 live connections kept. Book 1,584 ms median / 2,323 ms 95th; sign-in 564 / 1,325; quote 478 / 985.
- Full rides: 5,333 requests, 0 errors; 105 booked, 93 assigned and completed, 0 "no driver found" (12 were still searching when the 60 s ended).
- Time to get a driver: median **6 s**, 95th **23 s**, max 27 s. That 95th is past the 20 s offer window: with 30 riders asking at once for 50 drivers, some riders waited for a second driver. Complete: 903 ms median / 2.4 s 95th. Accept: 955 ms / 2.6 s.
- Reading: the laptop is also running the database and the load generator, so absolute numbers are pessimistic. What matters is the shape: nothing failed, and the slow part at scale is dispatch rounds, not errors. **Repeat on staging before drawing conclusions** and watch `GET /admin/system/metrics`.

## What the load test found (and what was changed)
**Real defect, fixed:** when several riders asked from the same area, dispatch offered *every* ride to the same nearest driver. A driver can take only one, so the other riders waited out the full 20-second offer window before the next driver was tried. Now (1) a driver already holding a live offer is not offered another ride, and (2) when a driver takes a ride their other open offers are closed at once. Covered by `tests/dispatch-offers.test.ts`; the older race test was updated (the double offer is now only possible through a race, which it simulates).

**Not defects:** a few location updates get `429` because the script posts an extra location right at pickup, inside the 1-second throttle (the throttle is working as designed).

## Still to do on staging
- Run both scripts against the staging host and database and record the numbers here.
- Try 200+ riders and 50+ drivers to find where it bends; watch `GET /admin/system/metrics` and Atlas metrics during the run.
- Repeat after any change to dispatch, booking or the database indexes.
