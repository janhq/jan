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

// Function to capture app version and operating system
function captureAppVersionAndOS() {
  const properties: Properties = {
    JanVersion: VERSION,
    userOperatingSystem: getOperatingSystem(),
  }
  posthog.capture(AnalyticsEvent.Ping, properties)
}

captureAppVersionAndOS()
