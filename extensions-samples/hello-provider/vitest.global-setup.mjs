// The bundle test runs dist/index.js, so build it before the tests start
// rather than trusting whatever dist holds from the last build.
import { buildBundle } from './scripts/build.mjs'

export default async function setup() {
  await buildBundle()
}
