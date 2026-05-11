import React from "react";
import {
  MarketingIntegrationSetupScreen,
  MarketingIntegrationStatus,
} from "./MarketingIntegrationSetupScreen";
import {
  useClearstreamStatus,
  useConnectClearstream,
  useDisconnectClearstream,
  useListClearstreamGroups,
  useSetClearstreamList,
} from "../hooks/useMarketingIntegrations";

export function ClearstreamSetupScreen() {
  const { data, isLoading } = useClearstreamStatus();
  const connect = useConnectClearstream();
  const setList = useSetClearstreamList();
  const disconnect = useDisconnectClearstream();
  const listGroups = useListClearstreamGroups();

  const status: MarketingIntegrationStatus | null = data
    ? {
        isConnected: data.isConnected,
        status: data.status,
        lastSyncAt: data.lastSyncAt,
        lastError: data.lastError,
        destinationId: data.listId,
        destinationName: data.listName,
        connectedBy: data.connectedBy,
      }
    : null;

  return (
    <MarketingIntegrationSetupScreen
      displayName="Clearstream"
      destinationNoun="list"
      description="Connect Clearstream to automatically add new community members to one of your subscriber lists, so you can send them SMS campaigns without manually exporting contacts."
      status={status}
      isStatusLoading={isLoading}
      onConnect={({ apiKey, destinationId, destinationName }) =>
        connect({ apiKey, listId: destinationId, listName: destinationName })
      }
      onSetDestination={({ destinationId, destinationName }) =>
        setList({ listId: destinationId, listName: destinationName })
      }
      onListDestinations={(apiKey) => listGroups(apiKey)}
      onDisconnect={() => disconnect()}
    />
  );
}
