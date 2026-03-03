/**
 * Stub file for integrations API.
 * TODO: Migrate these functions to tRPC or implement properly.
 */

export const integrationsApi = {
  startPlanningCenterAuth: async (_params: { redirect_uri: string }) => {
    throw new Error("Planning Center integration not yet implemented via tRPC");
  },
  disconnectPlanningCenter: async () => {
    throw new Error("Planning Center integration not yet implemented via tRPC");
  },
};
