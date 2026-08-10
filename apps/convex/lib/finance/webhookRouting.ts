/**
 * Which handler owns a Stripe event that BOTH billing and giving can receive.
 *
 * `/stripe-webhook` (http.ts) is a single endpoint fed by two Stripe event
 * destinations: the platform account (SaaS billing — a community's Togather
 * subscription) and "Events from: Connected accounts" (group giving —
 * ADR-032 §6). Three event types are ambiguous between them, because a
 * recurring donation is also a Stripe Subscription:
 * `customer.subscription.updated`, `customer.subscription.deleted`, and
 * `invoice.payment_failed`.
 *
 * Stripe disambiguates them for us: an event delivered for a connected
 * account carries that account's id in `event.account`, and a platform-account
 * event never does. So the account field — not the event type, and not
 * metadata we set — is the routing key.
 *
 * Lives here rather than inline in http.ts so the routing rule is testable
 * without standing up the whole signature-verified HTTP route.
 */
export function isConnectEvent(event: { account?: string | null }): boolean {
  return typeof event.account === "string" && event.account.length > 0;
}
