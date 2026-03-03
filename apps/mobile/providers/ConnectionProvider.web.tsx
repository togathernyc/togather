/**
 * ConnectionProvider (Web) - No-op passthrough
 *
 * Offline mode is a native-only concern (NetInfo, cellular detection, etc.).
 * On web, we always report "connected" and render children directly.
 */
import React, { createContext, useContext } from 'react';

type ConnectionStatus = 'connected';

interface ConnectionContextType {
  status: ConnectionStatus;
  isNetworkAvailable: boolean;
  isWebSocketConnected: boolean;
  isInternetReachable: boolean;
  connectionType: string;
  cellularGeneration: string | null;
  isEffectivelyOffline: boolean;
}

const ConnectionContext = createContext<ConnectionContextType>({
  status: 'connected',
  isNetworkAvailable: true,
  isWebSocketConnected: true,
  isInternetReachable: true,
  connectionType: 'wifi',
  cellularGeneration: null,
  isEffectivelyOffline: false,
});

export const useConnectionStatus = () => useContext(ConnectionContext);

export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <>{children}</>;
