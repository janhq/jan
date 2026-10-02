/**
 * Runtime platform detection for shortcuts.
 *
 * Deliberately not the IS_MACOS build constant: the same bundle also runs in a
 * plain browser, where the host OS is only known from the user agent.
 */
export const isMac =
  typeof navigator !== 'undefined' &&
  navigator.userAgent.toUpperCase().indexOf('MAC') >= 0
