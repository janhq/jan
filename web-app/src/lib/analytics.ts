/**
 * Google Analytics utility functions
 */

/**
 * Track custom events with Google Analytics
 */
export function trackEvent(
  eventName: string,
  parameters?: Record<string, unknown>
) {
  if (!window.gtag) {
    return
  }

  window.gtag('event', eventName, parameters)
}
