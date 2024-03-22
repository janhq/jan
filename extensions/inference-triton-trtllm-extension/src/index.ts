/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-nvidia-triton-trt-llm-extension/src/index
 */

import {
  AppConfigurationEventName,
  events,
  fs,
  joinPath,
  Model,
  RemoteOAIEngine,
} from '@janhq/core'
import { join } from 'path'

/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceTritonTrtLLMExtension extends RemoteOAIEngine {
  private readonly _engineDir = 'file://engines'
  private readonly _engineMetadataFileName = 'triton_trtllm.json'

  inferenceUrl: string = ''
  provider: string = 'triton_trtllm'
  apiKey: string = ''

  _engineSettings: {
    base_url: ''
    api_key: ''
  }

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    super.onLoad()
    if (!(await fs.existsSync(this._engineDir))) {
      await fs.mkdir(this._engineDir)
    }

    this.writeDefaultEngineSettings()

    const settingsFilePath = await joinPath([
      this._engineDir,
      this._engineMetadataFileName,
    ])

    // Events subscription
    events.on(
      AppConfigurationEventName.OnConfigurationUpdate,
      (settingsKey: string) => {
        // Update settings on changes
        if (settingsKey === settingsFilePath) this.writeDefaultEngineSettings()
      }
    )
  }

  async writeDefaultEngineSettings() {
    try {
      const engine_json = join(this._engineDir, this._engineMetadataFileName)
      if (await fs.existsSync(engine_json)) {
        const engine = await fs.readFileSync(engine_json, 'utf-8')
        this._engineSettings =
          typeof engine === 'object' ? engine : JSON.parse(engine)
        this.inferenceUrl = this._engineSettings.base_url
        this.apiKey = this._engineSettings.api_key
      } else {
        await fs.writeFileSync(
          engine_json,
          JSON.stringify(this._engineSettings, null, 2)
        )
      }
    } catch (err) {
      console.error(err)
    }
  }
}
