import { useEffect } from 'react'
import { useLocation } from '@tanstack/react-router'

declare global {
  interface Window {
    gtag?: (...args: any[]) => void
    dataLayer?: any[]
  }
  const GA_MEASUREMENT_ID: string
}

export function GoogleAnalyticsProvider() {
  const location = useLocation()

  useEffect(() => {
    // Check if GA ID is properly configured
    if (!GA_MEASUREMENT_ID || GA_MEASUREMENT_ID === 'G-XXXXXXXXXX') {
      console.warn(
        'Google Analytics not initialized: Invalid GA_MEASUREMENT_ID'
      )
      return
    }

    // Load Google Analytics script
    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`

    // Handle loading errors
    script.onerror = () => {
      console.warn('Failed to load Google Analytics script')
    }

    document.head.appendChild(script)

    // Initialize gtag
    window.dataLayer = window.dataLayer || []
    window.gtag = function () {
      window.dataLayer?.push(arguments)
    }
    window.gtag('js', new Date())
    window.gtag('config', GA_MEASUREMENT_ID, {
      send_page_view: false, // We'll manually track page views
    })

    return () => {
      // Cleanup: Remove script on unmount
      if (script.parentNode) {
        script.parentNode.removeChild(script)
      }
    }
  }, [])

  // Track page views on route change
  useEffect(() => {
    if (!window.gtag) {
      return
    }

    window.gtag('event', 'page_view', {
      page_path: location.pathname + location.search,
      page_location: window.location.href,
      page_title: document.title,
    })
  }, [location])

  return null
}

// Helper function to track custom events
export function trackEvent(
  eventName: string,
  parameters?: Record<string, any>
) {
  if (!window.gtag) {
    return
  }

  window.gtag('event', eventName, parameters)
}
