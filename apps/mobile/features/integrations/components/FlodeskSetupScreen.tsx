import React from "react";
import {
  MarketingIntegrationSetupScreen,
  MarketingIntegrationStatus,
} from "./MarketingIntegrationSetupScreen";
import {
  useConnectFlodesk,
  useDisconnectFlodesk,
  useFlodeskStatus,
  useListFlodeskSegments,
  useSetFlodeskSegment,
} from "../hooks/useMarketingIntegrations";

export function FlodeskSetupScreen() {
  const { data, isLoading } = useFlodeskStatus();
  const connect = useConnectFlodesk();
  const setSegment = useSetFlodeskSegment();
  const disconnect = useDisconnectFlodesk();
  const listSegments = useListFlodeskSegments();

  const status: MarketingIntegrationStatus | null = data
    ? {
        isConnected: data.isConnected,
        status: data.status,
        lastSyncAt: data.lastSyncAt,
        lastError: data.lastError,
        destinationId: data.segmentId,
        destinationName: data.segmentName,
        connectedBy: data.connectedBy,
      }
    : null;

  return (
    <MarketingIntegrationSetupScreen
      displayName="Flodesk"
      destinationNoun="segment"
      description="Connect Flodesk to automatically add new community members to one of your segments, so you can send them email campaigns without manually exporting contacts."
      status={status}
      isStatusLoading={isLoading}
      onConnect={({ apiKey, destinationId, destinationName }) =>
        connect({
          apiKey,
          segmentId: destinationId,
          segmentName: destinationName,
        })
      }
      onSetDestination={({ destinationId, destinationName }) =>
        setSegment({ segmentId: destinationId, segmentName: destinationName })
      }
      onListDestinations={(apiKey) => listSegments(apiKey)}
      onDisconnect={() => disconnect()}
    />
  );
}
