import { ConvexHttpClient } from "convex/browser";

declare const __CONVEX_URL__: string;
declare const __CLI_ENV__: string;

const CONVEX_URL =
  process.env.TOGATHER_CONVEX_URL || __CONVEX_URL__;

let _client: ConvexHttpClient | null = null;

export function getClient(): ConvexHttpClient {
  if (!_client) {
    _client = new ConvexHttpClient(CONVEX_URL);
  }
  return _client;
}
