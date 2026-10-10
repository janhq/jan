import { isDev } from './utils'

export const isNightly = VERSION.includes('-')
export const isBeta = VERSION.includes('beta')
export const isProd = !isNightly && !isBeta && !isDev()

/**
 * Builds that are allowed to show the Cowork surface (sidebar tab, routes and
 * settings). Cowork is a preview feature: it ships in nightly builds and in the
 * local dev server, and stays out of beta and stable releases until it is
 * announced. Read it at render time - `isDev()` looks at `window.location`, so
 * tests can stub the channel per case.
 *
 * Beta releases carry a hyphen too (`0.7.4-beta`), so `isBeta` has to be
 * excluded explicitly - same rule the updater uses to label nightly builds.
 */
export const isCoworkEnabled = () => (isNightly && !isBeta) || isDev()
