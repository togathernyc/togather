import { useEffect } from 'react'
import { useParams } from 'react-router-dom'

/**
 * Redirects unknown /:slug paths to the Expo app's community landing page.
 *
 * Reserved slugs (matched by earlier routes) are excluded:
 * android, android-staging, contribute, issue, legal
 */
export function CommunityRedirect() {
  const { slug } = useParams<{ slug: string }>()

  useEffect(() => {
    if (slug) {
      // Replace history entry to avoid back-button redirect loop
      window.location.replace(`/c/${slug}`)
    }
  }, [slug])

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
      color: '#666',
    }}>
      Redirecting...
    </div>
  )
}
