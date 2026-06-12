/** Stub of @togather/shared for the demo bundle (only what screens reference). */
export const DOMAIN_CONFIG = {
  landingUrl: "https://togather.nyc",
  appUrl: "https://app.togather.nyc",
  baseDomain: "togather.nyc",
};

/** Format a ms timestamp as a local time string (demo approximation). */
export function formatTimeWithTimezone(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default { DOMAIN_CONFIG, formatTimeWithTimezone };
