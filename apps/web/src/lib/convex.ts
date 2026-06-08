import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'

/**
 * Convex client for the public web pages (e.g. the availability link).
 *
 * The deployment URL comes from `VITE_CONVEX_URL`. When it's missing we leave
 * the client null so the static landing pages still build/run — only the
 * Convex-backed routes show a configuration message.
 */
const url = import.meta.env.VITE_CONVEX_URL as string | undefined

export const convex = url ? new ConvexReactClient(url) : null

/**
 * Typed-enough function references to the public availability endpoints,
 * addressed by name so the web app needs no cross-package import of the
 * generated Convex API.
 */
export const publicAvailabilityApi = {
  get: makeFunctionReference<'query'>(
    'functions/scheduling/publicAvailability:getPublicAvailabilityRequest',
  ),
  submit: makeFunctionReference<'mutation'>(
    'functions/scheduling/publicAvailability:submitPublicAvailability',
  ),
}
