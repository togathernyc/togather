import { ConvexReactClient } from "convex/react";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL environment variable is not set");
}

export const convex = new ConvexReactClient(convexUrl);
