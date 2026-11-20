import { isDev } from './utils'

export const isNightly = VERSION.includes('-')
export const isBeta = VERSION.includes('beta')
export const isProd = !isNightly && !isBeta && !isDev()

/**
 * Builds that are allowed to show the Cowork surface (artifacts, skills, agent
 * settings, folder tasks and Cowork rows). Cowork is a preview feature: it
 * ships in nightly builds and in the local dev server, and stays out of beta
 * and stable releases until it is announced. Read it at render time - `isDev()`
 * looks at `window.location`, so tests can stub the channel per case.
 *
 * Beta releases carry a hyphen too (`0.7.4-beta`), so `isBeta` has to be
 * excluded explicitly - same rule the updater uses to label nightly builds.
 *
 * The migration of old Cowork sessions into threads is not gated: it runs on
 * every desktop build, so a nightly profile opened by a stable build is
 * converted the same way and shows up once Cowork ships there.
 */
export const isCoworkEnabled = () => (isNightly && !isBeta) || isDev()
