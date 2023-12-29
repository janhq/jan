import posthog, { Properties } from 'posthog-js'

posthog.init(ANALYTICS_ID, {
  api_host: ANALYTICS_HOST,
  autocapture: false,
  capture_pageleave: false, // disable automatic pageleave tracking
  rageclick: false, // disable automatic rageclick tracking
})

export const instance = posthog

// Constants for unwanted property keys
const UNWANTED_PROPERTIES = [
  '$ip',
  '$referrer',
  '$initial_referrer',
  '$referring_domain',
  '$initial_referring_domain',
  '$pathname',
  '$initial_pathname',
  '$browser_language',
  '$current_url',
  '$initial_current_url',
  '$browser',
  '$initial_browser',
  '$browser_version',
  '$initial_browser_version',
]

// Function to remove unnecessary properties
const filterProperties = (properties?: Properties): Properties | undefined => {
  return properties
    ? Object.fromEntries(
        Object.entries(properties).filter(
          ([key]) => !UNWANTED_PROPERTIES.includes(key)
        )
      )
    : undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Track an event with filtered properties
export const trackEvent = (name: string, properties?: Properties, appVersion?: string): void => {
  let eventProperties = filterProperties(properties);

  // Include app version if available
  if (appVersion) {
    eventProperties = { ...eventProperties, app_version: VERSION };
  }

  posthog.capture(name, eventProperties);
};

export enum AnalyticsEvent {}
