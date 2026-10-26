import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { Logger } from 'pino';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { ZodError, z } from 'zod';
import { AppError, type ErrorCode } from '../common/errors';
import { OPS_ROOM_ROLES } from '../common/enums';
import { resolveAuth, type AuthInfo } from '../middleware/auth';
import { Session } from '../modules/auth/session.model';
import { locationUpdateSchema } from '../modules/presence/presence.schemas';
import type { PresenceService } from '../modules/presence/presence.service';
import { User } from '../modules/users/user.model';
import type { RealtimeBus } from './bus';
import { ClientEvents, ServerEvents, type Envelope, type ServerEventName } from './events';

export type SocketServerOptions = {
  accessSecret: string;
  logger: Logger;
  presence: Pick<PresenceService, 'updateLocation'>;
  corsOrigins: string[];
  /** How often every live socket is re-checked against the database (logout, suspension). */
  revalidateMs?: number;
  /** After `auth:expired`, how long the client has to send `auth:refresh` before being dropped. */
  refreshGraceMs?: number;
  /** Extra connections beyond this evict the user's oldest. */
  maxSocketsPerUser?: number;
  /** Connection attempts one network address may make per minute (before any login check). Default 120. */
  handshakesPerMinute?: number;
  /** With several server instances, a Redis pair so a message reaches users connected to any of them. */
  redisAdapter?: { pub: Redis; sub: Redis };
};

type Ack = (reply: unknown) => void;
const asAck = (fn: unknown): Ack => (typeof fn === 'function' ? (fn as Ack) : () => undefined);

const userRoom = (userId: string) => `user:${userId}`;
const OPS_ROOM = 'ops';

function envelope<T extends object>(type: ServerEventName, data: T): Envelope<T> {
  return { id: randomUUID(), type, at: new Date().toISOString(), data };
}

function errorReply(err: unknown): { ok: false; error: { code: ErrorCode; message: string } } {
  if (err instanceof AppError)
    return { ok: false, error: { code: err.code, message: err.message } };
  if (err instanceof ZodError) {
    return {
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.' },
    };
  }
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } };
}

/**
 * The Socket.IO implementation of RealtimeBus. Create it first (so the app can be built with the
 * bus), then `attach` it to the HTTP server once that exists.
 */
export function createSocketBus() {
  let io: Server | null = null;
  let revalidateTimer: NodeJS.Timeout | null = null;
  let revalidate: () => Promise<number> = async () => 0;
  let logger: Logger | null = null;

  const bus: RealtimeBus = {
    emitToUsers(userIds, type, data) {
      if (!io || userIds.length === 0) return;
      try {
        io.to([...new Set(userIds)].map(userRoom)).emit(type, envelope(type, data));
      } catch (err) {
        logger?.error({ err, type }, 'realtime emit failed');
      }
    },
    emitToOps(type, data) {
      if (!io) return;
      try {
        io.to(OPS_ROOM).emit(type, envelope(type, data));
      } catch (err) {
        logger?.error({ err, type }, 'realtime emit failed');
      }
    },
    disconnectUser(userId, reason) {
      if (!io) return;
      const server = io;
      void (async () => {
        for (const s of await server.in(userRoom(userId)).fetchSockets()) {
          s.emit(ServerEvents.AUTH_REVOKED, envelope(ServerEvents.AUTH_REVOKED, { reason }));
          s.disconnect(true);
        }
      })().catch((err) => logger?.error({ err }, 'realtime disconnect failed'));
    },
  };

  function attach(httpServer: HttpServer, options: SocketServerOptions) {
    logger = options.logger;
    const refreshGraceMs = options.refreshGraceMs ?? 30_000;
    const maxSockets = options.maxSocketsPerUser ?? 5;
    const server = new Server(httpServer, {
      serveClient: false,
      // Mobile apps are not browsers; CORS only matters for the admin panel.
      cors: { origin: options.corsOrigins },
      // A GPS fix is tiny; refuse anything big.
      maxHttpBufferSize: 10_000,
    });
    if (options.redisAdapter) {
      // A Redis outage must not take the server down: local delivery keeps working.
      for (const c of [options.redisAdapter.pub, options.redisAdapter.sub]) {
        c.on('error', (err: Error) =>
          options.logger.warn({ err: err.message }, 'socket redis error'),
        );
      }
      server.adapter(createAdapter(options.redisAdapter.pub, options.redisAdapter.sub));
    }
    io = server;

    /* ---- handshake: first, a cheap per-address limit, so floods never reach the database ---- */
    const handshakeLimit = options.handshakesPerMinute ?? 120;
    const attempts = new Map<string, { count: number; resetAt: number }>();
    server.use((socket, next) => {
      const forwarded = String(socket.handshake.headers['x-forwarded-for'] ?? '')
        .split(',')
        .pop()
        ?.trim();
      const who = forwarded || socket.handshake.address;
      const nowMs = Date.now();
      if (attempts.size > 10_000) {
        for (const [k, v] of attempts) if (v.resetAt <= nowMs) attempts.delete(k);
      }
      const entry = attempts.get(who);
      if (!entry || entry.resetAt <= nowMs) {
        attempts.set(who, { count: 1, resetAt: nowMs + 60_000 });
        return next();
      }
      entry.count += 1;
      if (entry.count > handshakeLimit) {
        const failure = new Error('RATE_LIMITED') as Error & { data?: unknown };
        failure.data = { code: 'RATE_LIMITED' };
        return next(failure);
      }
      next();
    });

    /* ---- handshake: same checks as the REST API ---- */
    server.use(async (socket, next) => {
      try {
        const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
        const header = socket.handshake.headers.authorization ?? '';
        const token =
          typeof fromAuth === 'string' && fromAuth
            ? fromAuth
            : header.toLowerCase().startsWith('bearer ')
              ? header.slice(7)
              : '';
        if (!token) throw new AppError('UNAUTHENTICATED');
        socket.data['auth'] = await resolveAuth(options.accessSecret, token);
        next();
      } catch (err) {
        const code = err instanceof AppError ? err.code : 'UNAUTHENTICATED';
        const failure = new Error(code) as Error & { data?: unknown };
        failure.data = { code };
        next(failure);
      }
    });

    const authOf = (socket: Socket) => socket.data['auth'] as AuthInfo;

    /** Token lifetime: warn the client, then drop it if it does not send a fresh token in time. */
    function watchExpiry(socket: Socket) {
      const old = socket.data['timers'] as NodeJS.Timeout[] | undefined;
      old?.forEach(clearTimeout);
      const wait = Math.max(0, authOf(socket).expiresAtMs - Date.now());
      const warn = setTimeout(() => {
        socket.emit(ServerEvents.AUTH_EXPIRED, envelope(ServerEvents.AUTH_EXPIRED, {}));
        const drop = setTimeout(() => socket.disconnect(true), refreshGraceMs);
        drop.unref();
        socket.data['timers'] = [drop];
      }, wait);
      warn.unref();
      socket.data['timers'] = [warn];
    }

    server.on('connection', async (socket) => {
      const auth = authOf(socket);
      await socket.join(userRoom(auth.userId));
      if (OPS_ROOM_ROLES.includes(auth.role)) await socket.join(OPS_ROOM);

      // A user may have several devices, but not an unbounded number of connections.
      const mine = await server.in(userRoom(auth.userId)).fetchSockets();
      if (mine.length > maxSockets) {
        const surplus = mine
          .sort((a, b) => a.handshake.issued - b.handshake.issued)
          .slice(0, mine.length - maxSockets);
        for (const s of surplus) s.disconnect(true);
      }

      watchExpiry(socket);
      socket.on('disconnect', () => {
        (socket.data['timers'] as NodeJS.Timeout[] | undefined)?.forEach(clearTimeout);
      });

      socket.on(ClientEvents.AUTH_REFRESH, async (payload: unknown, ack?: unknown) => {
        const reply = asAck(ack);
        try {
          const { token } = z
            .object({ token: z.string().min(10) })
            .strict()
            .parse(payload);
          const next = await resolveAuth(options.accessSecret, token);
          if (next.userId !== auth.userId || next.sessionId !== auth.sessionId) {
            throw new AppError('FORBIDDEN', 'Token belongs to a different session.');
          }
          socket.data['auth'] = next;
          watchExpiry(socket);
          reply({ ok: true });
        } catch (err) {
          reply(errorReply(err));
        }
      });

      socket.on(ClientEvents.LOCATION_UPDATE, async (payload: unknown, ack?: unknown) => {
        const reply = asAck(ack);
        try {
          const current = authOf(socket);
          if (Date.now() > current.expiresAtMs) throw new AppError('UNAUTHENTICATED');
          if (current.role !== 'DRIVER') throw new AppError('FORBIDDEN');
          const input = locationUpdateSchema.parse(payload);
          reply({ ok: true, data: await options.presence.updateLocation(current.userId, input) });
        } catch (err) {
          if (!(err instanceof AppError || err instanceof ZodError)) {
            options.logger.error({ err }, 'socket location update failed');
          }
          reply(errorReply(err));
        }
      });

      socket.emit(
        ServerEvents.HELLO,
        envelope(ServerEvents.HELLO, {
          userId: auth.userId,
          role: auth.role,
          serverTime: new Date().toISOString(),
        }),
      );
    });

    /**
     * Logout and suspension are also pushed immediately where they happen; this sweep is the net
     * that catches every other way a session can end (refresh-token theft, expiry, deleted user).
     */
    revalidate = async () => {
      const sockets = await server.fetchSockets();
      if (sockets.length === 0) return 0;
      const sessionIds = [...new Set(sockets.map((s) => (s.data['auth'] as AuthInfo).sessionId))];
      const userIds = [...new Set(sockets.map((s) => (s.data['auth'] as AuthInfo).userId))];
      const [liveSessions, activeUsers] = await Promise.all([
        Session.find({ _id: { $in: sessionIds }, revokedAt: null, expiresAt: { $gt: new Date() } })
          .select('_id')
          .lean(),
        User.find({ _id: { $in: userIds }, accountStatus: 'ACTIVE' })
          .select('_id')
          .lean(),
      ]);
      const okSession = new Set(liveSessions.map((s) => s._id.toString()));
      const okUser = new Set(activeUsers.map((u) => u._id.toString()));
      let dropped = 0;
      for (const s of sockets) {
        const a = s.data['auth'] as AuthInfo;
        if (okSession.has(a.sessionId) && okUser.has(a.userId)) continue;
        s.emit(
          ServerEvents.AUTH_REVOKED,
          envelope(ServerEvents.AUTH_REVOKED, { reason: 'SESSION_ENDED' }),
        );
        s.disconnect(true);
        dropped += 1;
      }
      return dropped;
    };
    revalidateTimer = setInterval(() => {
      revalidate().catch((err) => options.logger.error({ err }, 'socket revalidation failed'));
    }, options.revalidateMs ?? 30_000);
    revalidateTimer.unref();

    return server;
  }

  return {
    bus,
    attach,
    /** Re-check every connected socket now (exposed for tests and shutdown tooling). */
    revalidateNow: () => revalidate(),
    async close(): Promise<void> {
      if (revalidateTimer) clearInterval(revalidateTimer);
      const server = io;
      io = null;
      if (server) await new Promise<void>((resolve) => void server.close(() => resolve()));
    },
  };
}

export type SocketBus = ReturnType<typeof createSocketBus>;
