/**
 * LiteRT-LM extension - local CPU inference with Google's LiteRT-LM runtime.
 *
 * The runtime is driven by the shared local-engine base: a python sidecar
 * loads the model and serves the OpenAI chat-completions API, and this
 * extension talks to it over HTTP.
 */

import { LocalEngineExtension } from '@janhq/local-engine'

export default class litert_lm_extension extends LocalEngineExtension {
  readonly provider = 'litert-lm'
  readonly providerId = 'litert-lm'

  constructor() {
    super()
    this.settingsSchema = SETTINGS
  }
}
