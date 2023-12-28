import posthog, { Properties } from 'posthog-js'

posthog.init(ANALYTICS_ID, {
  api_host: ANALYTICS_HOST,
  autocapture: false,
  capture_pageleave: false, // disable automatic pageleave tracking
  rageclick: false, // disable automatic rageclick tracking
})

export const instance = posthog

// Function to remove unnecessary properties
const filterProperties = (properties?: Properties): Properties | undefined => {
  if (!properties) {
    return undefined;
  }

  // Create a shallow copy of the properties object
  const filteredProperties = { ...properties };

  // Remove unwanted properties
  delete filteredProperties['$ip'];
  delete filteredProperties['$referrer'];
  delete filteredProperties['$initial_referrer'];
  delete filteredProperties['$referring_domain'];
  delete filteredProperties['$initial_referring_domain'];
  delete filteredProperties['$pathname'];
  delete filteredProperties['$initial_pathname'];
  delete filteredProperties['$browser_language'];
  delete filteredProperties['$current_url'];
  delete filteredProperties['$initial_current_url'];
  delete filteredProperties['$browser'];
  delete filteredProperties['$initial_browser'];
  delete filteredProperties['$browser_version'];
  delete filteredProperties['$initial_browser_version'];

  return filteredProperties;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trackEvent = (name: string, properties?: Properties) => {
  // Filter out unwanted properties before sending the event
  const filteredProperties = filterProperties(properties);

  posthog.capture(name, filteredProperties);
}

export enum AnalyticsEvent {}
