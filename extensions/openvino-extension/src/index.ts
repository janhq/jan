/**
 * OpenVINO extension - local CPU inference with Intel's OpenVINO GenAI runtime.
 *
 * The runtime is driven by the shared local-engine base: a python sidecar
 * loads the model and serves the OpenAI chat-completions API, and this
 * extension talks to it over HTTP.
 */

import { LocalEngineExtension } from '@janhq/local-engine'

export default class openvino_extension extends LocalEngineExtension {
  readonly provider = 'openvino'
  readonly providerId = 'openvino'

  constructor() {
    super()
    this.settingsSchema = SETTINGS
  }
}
