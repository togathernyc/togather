/**
 * Helpers for rendering event host attribution (the "Hosted by …" line and the
 * row of host avatars) on the public event page. Kept pure so the formatting
 * rules can be unit-tested without mounting the screen.
 */

export type HostRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profilePhoto: string | null;
};

/**
 * Display name for a single host: first name plus last initial when both are
 * present (e.g. "Jane D."). Falls back to whichever part exists, or "" when the
 * host has no name at all.
 */
export function hostDisplayName(host: Pick<HostRow, "firstName" | "lastName">): string {
  const first = host.firstName?.trim() || "";
  const lastInitial = host.lastName?.trim()?.[0]
    ? `${host.lastName.trim()[0]}.`
    : "";
  return [first, lastInitial].filter(Boolean).join(" ").trim();
}

/**
 * The "Hosted by …" headline. Names up to two hosts (host + cohost) explicitly
 * so a cohost's name is always surfaced, then collapses any remainder into
 * "+ N others". Empty names (hosts with no name) are ignored. Returns a bare
 * "Hosted" when no host has a usable name.
 */
export function formatHostLine(hosts: Array<Pick<HostRow, "firstName" | "lastName">>): string {
  const names = hosts.map(hostDisplayName).filter(Boolean);

  if (names.length === 0) return "Hosted";
  if (names.length === 1) return `Hosted by ${names[0]}`;
  if (names.length === 2) return `Hosted by ${names[0]} & ${names[1]}`;

  const extra = names.length - 2;
  return `Hosted by ${names[0]}, ${names[1]} + ${extra} other${extra === 1 ? "" : "s"}`;
}
