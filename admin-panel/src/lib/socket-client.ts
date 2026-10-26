import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/auth-store';

let socket: Socket | null = null;

export function getSocketClient(): Socket {
  if (typeof window === 'undefined') {
    throw new Error('Socket client can only be used in browser context');
  }

  if (socket && socket.connected) {
    return socket;
  }

  if (!socket) {
    // Socket base URL defaults to origin or NEXT_PUBLIC_API_BASE_URL (stripping /api/v1)
    const baseUrl =
      process.env.NEXT_PUBLIC_SOCKET_SERVER_URL ||
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/v1\/?$/, '') ||
      process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/api\/v1\/?$/, '') ||
      (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

    const authState = useAuthStore.getState();
    const token = authState.user?.id || 'admin_token';

    socket = io(baseUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      autoConnect: true,
    });

    socket.on('connect', () => {
      // Sockets connect and join relevant rooms
    });

    socket.on('connect_error', (error) => {
      console.warn('[Socket] Connection error:', error.message);
    });
  }

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
