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
  useMemo,
  useRef,
  useCallback,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
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
  /** True if the disconnect happened during cold start (grace timer), not mid-session */
  const coldStartDisconnectRef = useRef(false);
  // Track latest network state so the grace timer callback can distinguish
  // "network down" from "WebSocket slow to connect"
  const isNetworkAvailableRef = useRef(true);

  const isWebSocketConnected = convexState.isWebSocketConnected;

  // Treat as effectively offline when:
  // - Network unavailable
  // - Internet not reachable (connected to WiFi with no internet / captive portal)
  const isEffectivelyOffline = devSimulatedOffline || !isNetworkAvailable || !isInternetReachable;
  const isConnected = !devSimulatedOffline && isNetworkAvailable && isInternetReachable && isWebSocketConnected;

  // Detect slow connection (2G or 3G cellular)
  const isSlowConnection = connectionType === 'cellular' &&
    (cellularGeneration === '2g' || cellularGeneration === '3g');

  // Use a ref to read current status inside the effect without including it
  // in the dependency array. Including `status` as a dep caused the effect to
  // re-run on every status change, creating a self-triggering cycle
  // (setStatus → re-render → effect re-runs → setStatus again). React's
  // same-value bail-out prevents true infinite loops, but the extra effect
  // re-runs are wasteful and fragile if inputs flicker.
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const currentStatus = statusRef.current;

    if (!isConnected) {
      // Clear reconnected timer if running
      if (reconnectedTimerRef.current) {
        clearTimeout(reconnectedTimerRef.current);
        reconnectedTimerRef.current = null;
      }

      if (currentStatus === 'connecting') {
        // Cold start: use longer grace period before showing red banner
        if (!startupGraceTimerRef.current) {
          startupGraceTimerRef.current = setTimeout(() => {
            startupGraceTimerRef.current = null;
            // Only show "No internet" if the device has no network at all.
            // Do NOT check isInternetReachable here — on Android it does an
            // HTTP probe that can report false for several seconds during cold
            // start, causing a false "No internet" banner that flips to
            // "Connected" once the probe completes.
            if (!isNetworkAvailableRef.current) {
              setStatus('disconnected');
              wasDisconnectedRef.current = true;
              coldStartDisconnectRef.current = true;
            }
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

      if (currentStatus === 'connecting') {
        // Cold start succeeded within grace period - connect silently, no banner
        setStatus(isSlowConnection ? 'slow' : 'connected');
      } else if (wasDisconnectedRef.current && coldStartDisconnectRef.current) {
        // Disconnect happened during cold start (grace timer), not a real
        // mid-session drop. Skip the "reconnected" banner — go straight to
        // connected so the user doesn't see a misleading green banner.
        wasDisconnectedRef.current = false;
        coldStartDisconnectRef.current = false;
        setStatus(isSlowConnection ? 'slow' : 'connected');
      } else if (wasDisconnectedRef.current) {
        // Real mid-session disconnect recovered - show reconnected banner
        setStatus('reconnected');
        wasDisconnectedRef.current = false;
        coldStartDisconnectRef.current = false;

        // Auto-dismiss after 3 seconds
        reconnectedTimerRef.current = setTimeout(() => {
          setStatus(isSlowConnection ? 'slow' : 'connected');
          reconnectedTimerRef.current = null;
        }, 3000);
      } else if (currentStatus !== 'reconnected') {
        // Not in reconnected state (which has its own timer) — sync with connection quality
        setStatus(isSlowConnection ? 'slow' : 'connected');
      }
    }

    return () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      if (startupGraceTimerRef.current)
        clearTimeout(startupGraceTimerRef.current);
    };
  }, [isConnected, isSlowConnection]);

  // Clear reconnected timer on unmount
  useEffect(() => {
    return () => {
      if (reconnectedTimerRef.current)
        clearTimeout(reconnectedTimerRef.current);
    };
  }, []);

  // When the app returns from background, iOS will have killed the WebSocket.
  // Reset to 'connecting' so we use the cold-start grace period (6s, no banner)
  // instead of the mid-session debounce (2s → red banner). The WebSocket
  // typically reconnects in 1-3s, well within the grace window.
  useEffect(() => {
    let previousState = AppState.currentState;

    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          previousState.match(/inactive|background/) &&
          nextState === 'active'
        ) {
          // Clear any pending disconnect timer from the backgrounding
          if (disconnectTimerRef.current) {
            clearTimeout(disconnectTimerRef.current);
            disconnectTimerRef.current = null;
          }
          // Reset to connecting — the main effect will re-evaluate and
          // either connect silently or start the grace timer
          setStatus('connecting');
          wasDisconnectedRef.current = false;
          coldStartDisconnectRef.current = false;
        }
        previousState = nextState;
      }
    );

    return () => subscription.remove();
  }, []);

  // Subscribe to NetInfo
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const networkAvailable = state.isConnected ?? false;
      const internetReachable = state.isInternetReachable ?? true;
      setIsNetworkAvailable(networkAvailable);
      setIsInternetReachable(internetReachable);
      isNetworkAvailableRef.current = networkAvailable;
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

  const contextValue = useMemo(
    () => ({
      status,
      isNetworkAvailable,
      isWebSocketConnected,
      isInternetReachable,
      connectionType,
      cellularGeneration,
      isEffectivelyOffline,
      ...(__DEV__ ? { simulateOffline } : {}),
    }),
    [
      status,
      isNetworkAvailable,
      isWebSocketConnected,
      isInternetReachable,
      connectionType,
      cellularGeneration,
      isEffectivelyOffline,
      simulateOffline,
    ]
  );

  return (
    <ConnectionContext.Provider value={contextValue}>
      {children}
    </ConnectionContext.Provider>
  );
};
