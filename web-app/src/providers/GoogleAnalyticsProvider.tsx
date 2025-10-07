import { useEffect } from 'react'
import { useLocation } from '@tanstack/react-router'
import { pageview } from '@/lib/analytics'


export function GoogleAnalyticsProvider() {
  const location = useLocation()

  // Track page views on route change
  useEffect(() => {
    // Skip if GA is not configured
    if (!GA_MEASUREMENT_ID) {
      return
    }

    // Track page view with current path
    const path = location.pathname + (window.location.search || '')
    pageview(path)
  }, [location])

  return null
}

