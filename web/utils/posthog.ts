import posthog, { Properties } from 'posthog-js'

posthog.init(ANALYTICS_ID, {
  api_host: ANALYTICS_HOST,
  autocapture: false,
  capture_pageleave: false, // disable automatic pageleave tracking
  rageclick: false, // disable automatic rageclick tracking
})

export const instance = posthog

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trackEvent = (name: string, properties?: Properties) => {
  posthog.capture(name, properties)
}

export enum AnalyticsEvent {}
