import posthog, { Properties } from 'posthog-js'

// Initialize PostHog
posthog.init(ANALYTICS_ID, {
  api_host: ANALYTICS_HOST,
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  rageclick: false,
})
// Export the PostHog instance
export const instance = posthog

// Enum for Analytics Events
export enum AnalyticsEvent {
  Ping = 'Ping',
}

// Function to determine the operating system
function getOperatingSystem(): string {
  if (isMac) return 'MacOS'
  if (isWindows) return 'Windows'
  if (isLinux) return 'Linux'
  return 'Unknown'
}

function captureAppVersionAndOS() {
  const properties: Properties = {
    $appVersion: VERSION,
    $userOperatingSystem: getOperatingSystem(),
    // Set the following Posthog default properties to empty strings
    $initial_browser: '',
    $browser: '',
    $initial_browser_version: '',
    $browser_version: '',
    $initial_current_url: '',
    $current_url: '',
    $initial_device_type: '',
    $device_type: '',
    $initial_pathname: '',
    $pathname: '',
    $initial_referrer: '',
    $referrer: '',
    $initial_referring_domain: '',
    $referring_domain: '',
  }
  posthog.capture(AnalyticsEvent.Ping, properties)
}

captureAppVersionAndOS()
