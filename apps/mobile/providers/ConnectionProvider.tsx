/**
 * ConnectionProvider - Network and WebSocket connection state
 *
 * Monitors device network connectivity (via NetInfo) and
 * Convex WebSocket connection state to provide unified connection status.
 *
 * State machine:
 *   connected -> disconnected (after 2s debounce)
 *   connected -> slow (when on 2G/3G cellular)
 *   disconnected -> reconnected (when connection restores)
 *   reconnected -> connected|slow (after 3s auto-dismiss)
 *
 * In __DEV__ mode, exposes simulateOffline() for testing.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useConvexConnectionState } from '@services/api/convex';

type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'slow'
  | 'reconnecting'
  | 'reconnected';

interface ConnectionContextType {
  status: ConnectionStatus;
  isNetworkAvailable: boolean;
  isWebSocketConnected: boolean;
  isInternetReachable: boolean;
  connectionType: string;
  cellularGeneration: string | null;
  isEffectivelyOffline: boolean;
  /** DEV ONLY: simulate offline for N seconds (default 5) */
  simulateOffline?: (durationMs?: number) => void;
}

const ConnectionContext = createContext<ConnectionContextType>({
  status: 'connected',
  isNetworkAvailable: true,
  isWebSocketConnected: true,
  isInternetReachable: true,
  connectionType: 'unknown',
  cellularGeneration: null,
  isEffectivelyOffline: false,
});

export const useConnectionStatus = () => useContext(ConnectionContext);

export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const convexState = useConvexConnectionState();
  const [isNetworkAvailable, setIsNetworkAvailable] = useState(true);
  const [isInternetReachable, setIsInternetReachable] = useState(true);
  const [connectionType, setConnectionType] = useState<string>('unknown');
  const [cellularGeneration, setCellularGeneration] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connected');

  // DEV: simulated override
  const [devSimulatedOffline, setDevSimulatedOffline] = useState(false);

  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const reconnectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const wasDisconnectedRef = useRef(false);

  const isWebSocketConnected = convexState.isWebSocketConnected;

  // Treat as effectively offline when:
  // - Network unavailable
  // - Internet not reachable (connected to WiFi with no internet / captive portal)
  const isEffectivelyOffline = devSimulatedOffline || !isNetworkAvailable || !isInternetReachable;
  const isConnected = !devSimulatedOffline && isNetworkAvailable && isInternetReachable && isWebSocketConnected;

  // Detect slow connection (2G or 3G cellular)
  const isSlowConnection = connectionType === 'cellular' &&
    (cellularGeneration === '2g' || cellularGeneration === '3g');

  useEffect(() => {
    if (!isConnected) {
      // Connection lost - start debounce timer
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
      }
      disconnectTimerRef.current = setTimeout(() => {
        setStatus('disconnected');
        wasDisconnectedRef.current = true;
      }, 2000);

      // Clear reconnected timer if running
      if (reconnectedTimerRef.current) {
        clearTimeout(reconnectedTimerRef.current);
        reconnectedTimerRef.current = null;
      }
    } else {
      // Connection restored
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }

      if (wasDisconnectedRef.current) {
        // Was disconnected - show reconnected
        setStatus('reconnected');
        wasDisconnectedRef.current = false;

        // Auto-dismiss after 3 seconds
        reconnectedTimerRef.current = setTimeout(() => {
          setStatus(isSlowConnection ? 'slow' : 'connected');
          reconnectedTimerRef.current = null;
        }, 3000);
      } else if (isSlowConnection) {
        setStatus('slow');
      } else {
        setStatus('connected');
      }
    }

    return () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      if (reconnectedTimerRef.current)
        clearTimeout(reconnectedTimerRef.current);
    };
  }, [isConnected, isSlowConnection]);

  // Subscribe to NetInfo
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsNetworkAvailable(state.isConnected ?? false);
      setIsInternetReachable(state.isInternetReachable ?? true);
      setConnectionType(state.type ?? 'unknown');

      // Extract cellular generation
      if (state.type === 'cellular' && state.details && 'cellularGeneration' in state.details) {
        setCellularGeneration((state.details as any).cellularGeneration ?? null);
      } else {
        setCellularGeneration(null);
      }
    });

    return () => unsubscribe();
  }, []);

  // DEV: simulate offline for testing the banner
  const simulateOffline = useCallback((durationMs: number = 5000) => {
    console.log(`[ConnectionProvider] Simulating offline for ${durationMs}ms`);
    setDevSimulatedOffline(true);
    setTimeout(() => {
      console.log('[ConnectionProvider] Simulated offline ended');
      setDevSimulatedOffline(false);
    }, durationMs);
  }, []);

  // DEV: expose on global for console testing
  useEffect(() => {
    if (__DEV__) {
      (global as any).__simulateOffline = simulateOffline;
    }
    return () => {
      if (__DEV__) {
        delete (global as any).__simulateOffline;
      }
    };
  }, [simulateOffline]);

  return (
    <ConnectionContext.Provider
      value={{
        status,
        isNetworkAvailable,
        isWebSocketConnected,
        isInternetReachable,
        connectionType,
        cellularGeneration,
        isEffectivelyOffline,
        ...(__DEV__ ? { simulateOffline } : {}),
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
};
