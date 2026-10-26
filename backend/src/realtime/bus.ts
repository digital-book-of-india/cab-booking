import type { ServerEventName } from './events';

/**
 * What the rest of the app uses to talk to connected clients. The Socket.IO implementation lives in
 * socketServer.ts; a Redis-backed variant for several server instances can replace it later
 * without touching any business code.
 */
export interface RealtimeBus {
  /** Send an event to every connected device of these users. Never throws. */
  emitToUsers(userIds: string[], type: ServerEventName, data: object): void;
  /** Send an event to every connected staff member. Never throws. */
  emitToOps(type: ServerEventName, data: object): void;
  /** End all of a user's sockets (suspension, logout). Never throws. */
  disconnectUser(userId: string, reason: string): void;
}

export const nullBus: RealtimeBus = {
  emitToUsers: () => undefined,
  emitToOps: () => undefined,
  disconnectUser: () => undefined,
};
