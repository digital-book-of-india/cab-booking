import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

const SOCKET_SERVER_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (process.env.NEXT_PUBLIC_API_BASE_URL
    ? process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/api\/v1\/?$/, '')
    : 'http://localhost:4000');

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
}

/**
 * Returns the singleton Socket.IO client instance.
 * Connects lazily or updates token if already created.
 */
export function getSocket(): Socket {
  const token = getAuthToken();

  if (!socketInstance) {
    socketInstance = io(SOCKET_SERVER_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: {
        token: token || '',
      },
      extraHeaders: token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : undefined,
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    socketInstance.on('connect', () => {
      console.log('⚡ Socket connected to backend radar:', socketInstance?.id);
    });

    socketInstance.on('connect_error', (err) => {
      console.warn('⚠️ Socket connection error:', err.message);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
    });

    socketInstance.on('hello', (data) => {
      console.log('👋 Socket HELLO handshake acknowledged:', data);
    });
  } else {
    // If token changed, update socket auth safely
    if (token && socketInstance.auth && typeof socketInstance.auth === 'object') {
      const authObj = socketInstance.auth as Record<string, unknown>;
      if (authObj['token'] !== token) {
        authObj['token'] = token;
      }
    }
  }

  return socketInstance;
}

/**
 * Ensures connection is active.
 */
export function connectSocket(): Socket {
  const socket = getSocket();
  const token = getAuthToken();
  if (token && socket.auth && typeof socket.auth === 'object') {
    (socket.auth as Record<string, unknown>)['token'] = token;
  }
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}

/**
 * Disconnects socket cleanly.
 */
export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

export interface DriverLocationPayload {
  driverId: string;
  userId?: string;
  lat: number;
  lng: number;
  headingDegrees?: number;
  speedKmh?: number;
  recordedAt?: string;
  simulated?: boolean;
}

/**
 * Convenience helper to subscribe to driver location telemetry events.
 * Listens to both 'driver.location.updated' and standard 'driver:location' envelope.
 */
export function onDriverLocation(
  callback: (payload: DriverLocationPayload) => void
): () => void {
  const socket = getSocket();

  const handleUpdate = (payload: unknown) => {
    // Unpack envelope if wrapped safely
    const payloadObj = payload as { data?: Record<string, unknown> } | Record<string, unknown>;
    const data = (payloadObj && 'data' in payloadObj && payloadObj.data ? payloadObj.data : payloadObj) as Record<string, unknown>;
    
    if (data && typeof data['lat'] === 'number' && typeof data['lng'] === 'number') {
      callback({
        driverId: String(data['driverId'] || data['userId'] || ''),
        userId: data['userId'] ? String(data['userId']) : undefined,
        lat: Number(data['lat']),
        lng: Number(data['lng']),
        headingDegrees: typeof data['headingDegrees'] === 'number' ? data['headingDegrees'] : 0,
        speedKmh: typeof data['speedKmh'] === 'number' ? data['speedKmh'] : 0,
        recordedAt: typeof data['recordedAt'] === 'string' ? data['recordedAt'] : new Date().toISOString(),
        simulated: Boolean(data['simulated']),
      });
    }
  };

  socket.on('driver.location.updated', handleUpdate);
  socket.on('driver:location', handleUpdate);

  return () => {
    socket.off('driver.location.updated', handleUpdate);
    socket.off('driver:location', handleUpdate);
  };
}

/**
 * Triggers dev/ops driver simulation movement ping.
 */
export function emitSimulateLocation(
  driverId: string,
  lat: number,
  lng: number,
  headingDegrees = 0,
  speedKmh = 35
): void {
  const socket = getSocket();
  if (socket.connected) {
    socket.emit('ops:simulate_driver_location', {
      driverId,
      lat,
      lng,
      headingDegrees,
      speedKmh,
    });
  }
}