/**
 * Google Analytics utility functions
 */

/**
 * Track page views for SPA navigation
 */
export const pageview = (path: string) => {
  if (!window.gtag) return

  window.gtag('event', 'page_view', {
    page_location: window.location.href,
    page_path: path,
  })
}

/**
 * Track custom events with Google Analytics
 */
export function trackEvent(
  eventName: string,
  parameters?: Record<string, unknown>
) {
  if (!window.gtag) return

  window.gtag('event', eventName, parameters)
}
