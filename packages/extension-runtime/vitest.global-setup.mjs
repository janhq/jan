// The prelude tests run the real built prelude, so build it before they
// start rather than trusting whatever dist holds from the last build.
import { buildPrelude } from './scripts/build-prelude.mjs'

export default async function setup() {
  await buildPrelude()
}
