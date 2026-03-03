"use client";

/**
 * Event Page Route Component
 *
 * This handles CLIENT-SIDE routing after the SPA loads.
 * For initial HTTP requests, the custom server (scripts/serve-with-og.js) handles:
 * - Bots: Returns HTML with OG meta tags
 * - Users: Proxies to expo serve which returns the SPA shell
 */

import EventPageClient from "./EventPageClient";

export default function EventPage() {
  return <EventPageClient />;
}
