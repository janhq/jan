// src/lib/extensions/__tests__/sample.integration.test.ts runs the built
// hello-provider sample through the real host, so build it before the tests
// start rather than trusting whatever dist holds from the last build.
import { buildBundle } from '../extensions-samples/hello-provider/scripts/build.mjs'

export default async function setup() {
  await buildBundle()
}
