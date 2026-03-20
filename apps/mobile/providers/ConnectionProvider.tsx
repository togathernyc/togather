/** Grace period before showing red banner on cold start (NetInfo + WebSocket init) */
const COLD_START_GRACE_MS = 6000;
/** Debounce before showing disconnected when connection drops mid-session */
const DISCONNECT_DEBOUNCE_MS = 2000;

/**
 * ConnectionProvider - Network and WebSocket connection state
 *
 * Monitors device network connectivity (via NetInfo) and
 * Convex WebSocket connection state to provide unified connection status.
 *
 * State machine:
 *   connecting -> connected (when connection established within grace period)
 *   connecting -> disconnected (after COLD_START_GRACE_MS if still not connected)
 *   connected -> disconnected (after 2s debounce)
 *   connected -> slow (when on 2G/3G cellular)
 *   disconnected -> reconnected (when connection restores)
 *   reconnected -> connected|slow (after 3s auto-dismiss)
 *
 * Cold start: Uses longer grace period to avoid false "No internet" during
 * NetInfo/WebSocket initialization. Mid-session disconnects use 2s debounce.
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
  | 'connecting'  // Cold start: invisible, no banner until grace period expires
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
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  // DEV: simulated override
  const [devSimulatedOffline, setDevSimulatedOffline] = useState(false);

  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const reconnectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const startupGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const wasDisconnectedRef = useRef(false);
  const hasEverConnectedRef = useRef(false);

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
      // Clear reconnected timer if running
      if (reconnectedTimerRef.current) {
        clearTimeout(reconnectedTimerRef.current);
        reconnectedTimerRef.current = null;
      }

      if (status === 'connecting') {
        // Cold start: use longer grace period before showing red banner
        if (!startupGraceTimerRef.current) {
          startupGraceTimerRef.current = setTimeout(() => {
            setStatus('disconnected');
            wasDisconnectedRef.current = true;
            startupGraceTimerRef.current = null;
          }, COLD_START_GRACE_MS);
        }
      } else {
        // Mid-session disconnect: use 2s debounce
        if (startupGraceTimerRef.current) {
          clearTimeout(startupGraceTimerRef.current);
          startupGraceTimerRef.current = null;
        }
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
        }
        disconnectTimerRef.current = setTimeout(() => {
          setStatus('disconnected');
          wasDisconnectedRef.current = true;
          disconnectTimerRef.current = null;
        }, DISCONNECT_DEBOUNCE_MS);
      }
    } else {
      // Connection established
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      if (startupGraceTimerRef.current) {
        clearTimeout(startupGraceTimerRef.current);
        startupGraceTimerRef.current = null;
      }

      if (status === 'connecting') {
        // Cold start succeeded within grace period - connect silently, no banner
        setStatus(isSlowConnection ? 'slow' : 'connected');
        hasEverConnectedRef.current = true;
      } else if (wasDisconnectedRef.current) {
        // Was disconnected - show reconnected
        setStatus('reconnected');
        wasDisconnectedRef.current = false;

        // Auto-dismiss after 3 seconds
        reconnectedTimerRef.current = setTimeout(() => {
          setStatus(isSlowConnection ? 'slow' : 'connected');
          reconnectedTimerRef.current = null;
        }, 3000);
      } else if (status === 'reconnected') {
        // Already showing reconnected - effect re-ran due to status in deps; don't overwrite
        // The reconnected timer will transition to connected/slow
      } else if (isSlowConnection) {
        setStatus('slow');
      } else {
        setStatus('connected');
      }
      hasEverConnectedRef.current = true;
    }

    return () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      if (startupGraceTimerRef.current)
        clearTimeout(startupGraceTimerRef.current);
      // Don't clear reconnectedTimerRef here - effect re-runs when status changes to
      // 'reconnected', and we need that timer to fire. It's cleared when going offline.
    };
  }, [isConnected, isSlowConnection, status]);

  // Clear reconnected timer on unmount
  useEffect(() => {
    return () => {
      if (reconnectedTimerRef.current)
        clearTimeout(reconnectedTimerRef.current);
    };
  }, []);

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
