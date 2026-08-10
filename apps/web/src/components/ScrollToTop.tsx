import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Scrolls to top of page on route change.
 * This ensures that when navigating between pages (e.g., from footer to legal pages),
 * the new page starts at the top instead of preserving the previous scroll position.
 *
 * A URL with a hash is the exception: scroll to that section instead, so links
 * into a specific part of a guide land there (the seeded "Partner with us"
 * demo link points at /guides/create-your-community#giving). The browser can't
 * do it for us — the target doesn't exist yet when the SPA first paints.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        target.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
}
