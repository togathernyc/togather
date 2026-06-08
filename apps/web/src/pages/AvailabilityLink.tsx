import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import {
  ConvexProvider,
  useMutation,
  useQuery,
} from 'convex/react'
import { convex, publicAvailabilityApi } from '../lib/convex'

const APP_STORE_URL =
  'https://apps.apple.com/us/app/togather-life-in-community/id6756286011'

type AvailStatus = 'available' | 'unavailable'

type RequestEvent = {
  _id: string
  title: string
  eventDate: number
  times: Array<{ label: string; startsAt: number }>
}

type PublicRequest = {
  publicToken: string
  message?: string
  groupId: string
  groupName: string
  communityName: string
  events: RequestEvent[]
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Public, app-optional availability page (`/a/:token`).
 *
 * Works fully in the browser: a guest enters their name + phone and marks
 * which upcoming events they can serve. Their response is matched to their
 * account when they later sign up and verify that phone (handled server-side).
 * If they already have the app, an "Open in app" affordance deep-links there.
 */
export function AvailabilityLink() {
  if (!convex) {
    return (
      <Centered>
        <p className="text-gray-600">
          This page isn’t configured. (Missing <code>VITE_CONVEX_URL</code>.)
        </p>
      </Centered>
    )
  }
  return (
    <ConvexProvider client={convex}>
      <AvailabilityForm />
    </ConvexProvider>
  )
}

function AvailabilityForm() {
  const { token } = useParams<{ token: string }>()
  const data = useQuery(
    publicAvailabilityApi.get,
    token ? { publicToken: token } : 'skip',
  ) as PublicRequest | null | undefined
  const submit = useMutation(publicAvailabilityApi.submit)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [responses, setResponses] = useState<Record<string, AvailStatus>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<null | { matched: boolean }>(null)

  const availableCount = useMemo(
    () => Object.values(responses).filter((s) => s === 'available').length,
    [responses],
  )

  if (data === undefined) {
    return <Centered><Spinner /></Centered>
  }
  if (data === null) {
    return (
      <Centered>
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900">Link not found</h1>
          <p className="mt-2 text-gray-600">
            This availability link is no longer valid. Ask your leader for a new one.
          </p>
        </div>
      </Centered>
    )
  }

  if (done) {
    return <SuccessScreen matched={done.matched} token={token} />
  }

  const setStatus = (planId: string, status: AvailStatus) => {
    setResponses((prev) => {
      const next = { ...prev }
      if (next[planId] === status) delete next[planId]
      else next[planId] = status
      return next
    })
  }

  const onSubmit = async () => {
    setError(null)
    if (!firstName.trim()) {
      setError('Please enter your name.')
      return
    }
    if (phone.replace(/\D/g, '').length < 10) {
      setError('Please enter a valid phone number.')
      return
    }
    const payload = data.events
      .filter((e) => responses[e._id])
      .map((e) => ({ planId: e._id, status: responses[e._id] }))
    if (payload.length === 0) {
      setError('Mark at least one event before submitting.')
      return
    }
    setSubmitting(true)
    try {
      const result = (await submit({
        publicToken: data.publicToken,
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        phone: phone.trim(),
        responses: payload,
      })) as { matched: boolean; savedCount: number }
      setDone({ matched: result.matched })
    } catch (e) {
      const err = e as { data?: { message?: string }; message?: string }
      setError(err?.data?.message ?? err?.message ?? 'Something went wrong. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-indigo-600">
          {data.communityName}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">
          Your availability
        </h1>
        <p className="mt-1 text-gray-600">
          {data.message?.trim()
            ? data.message
            : `Let ${data.groupName} know which dates you can serve.`}
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Marking available is just a heads-up — your leader still builds the
          final schedule.
        </p>
      </header>

      <ul className="space-y-3">
        {data.events.map((event) => {
          const status = responses[event._id]
          const dateLine = [
            formatDate(event.eventDate),
            event.times.map((t) => t.label).join(', '),
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <li
              key={event._id}
              className="rounded-xl border border-gray-200 p-3"
            >
              <div className="font-semibold text-gray-900">{event.title}</div>
              {dateLine && (
                <div className="mt-0.5 text-sm text-gray-500">{dateLine}</div>
              )}
              <div className="mt-3 flex gap-2">
                <ToggleButton
                  active={status === 'available'}
                  activeClass="bg-green-600 text-white border-green-600"
                  onClick={() => setStatus(event._id, 'available')}
                >
                  Available
                </ToggleButton>
                <ToggleButton
                  active={status === 'unavailable'}
                  activeClass="bg-red-600 text-white border-red-600"
                  onClick={() => setStatus(event._id, 'unavailable')}
                >
                  Can’t make it
                </ToggleButton>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="mt-6 space-y-3">
        <input
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 outline-none focus:border-indigo-500"
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          autoComplete="given-name"
        />
        <input
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 outline-none focus:border-indigo-500"
          placeholder="Last name (optional)"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          autoComplete="family-name"
        />
        <input
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 outline-none focus:border-indigo-500"
          placeholder="Phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          autoComplete="tel"
        />
        <p className="text-xs text-gray-500">
          We use your number to match this to your account when you join the
          app. We’ll verify it then — no spam.
        </p>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {submitting
          ? 'Submitting…'
          : `Submit availability${availableCount ? ` (${availableCount} available)` : ''}`}
      </button>
    </div>
  )
}

function SuccessScreen({
  matched,
  token,
}: {
  matched: boolean
  token: string | undefined
}) {
  return (
    <Centered>
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl">
          ✓
        </div>
        <h1 className="text-2xl font-bold text-gray-900">You’re all set!</h1>
        <p className="mt-2 text-gray-600">
          {matched
            ? 'Looks like you already have a Togather account. Open the app to manage your schedule.'
            : 'Get the Togather app to confirm your number and manage future requests.'}
        </p>
        <div className="mt-6 space-y-3">
          {token && (
            <a
              href={`togather://a/${token}`}
              className="block w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white"
            >
              Open in the Togather app
            </a>
          )}
          <div className="flex justify-center gap-3">
            <a
              href={APP_STORE_URL}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
            >
              App Store
            </a>
            <a
              href="/android"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
            >
              Android
            </a>
          </div>
        </div>
      </div>
    </Centered>
  )
}

function ToggleButton({
  active,
  activeClass,
  onClick,
  children,
}: {
  active: boolean
  activeClass: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full border px-3 py-2 text-sm font-semibold ${
        active ? activeClass : 'border-gray-300 bg-white text-gray-600'
      }`}
    >
      {children}
    </button>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      {children}
    </div>
  )
}

function Spinner() {
  return (
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600" />
  )
}
