/**
 * @file This file exports a class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 * @version 1.0.0
 * @module inference-groq-extension/src/index
 */

import {
  events,
  fs,
  AppConfigurationEventName,
  joinPath,
  RemoteOAIEngine,
} from '@janhq/core'
import { join } from 'path'

declare const COMPLETION_URL: string
/**
 * A class that implements the InferenceExtension interface from the @janhq/core package.
 * The class provides methods for initializing and stopping a model, and for making inference requests.
 * It also subscribes to events emitted by the @janhq/core package and handles new message requests.
 */
export default class JanInferenceGroqExtension extends RemoteOAIEngine {
  private readonly _engineDir = 'file://engines'
  private readonly _engineMetadataFileName = 'groq.json'

  inferenceUrl: string = COMPLETION_URL
  provider = 'groq'
  apiKey = ''

  private _engineSettings = {
    full_url: COMPLETION_URL,
    api_key: 'gsk-<your key here>',
  }

  /**
   * Subscribes to events emitted by the @janhq/core package.
   */
  async onLoad() {
    super.onLoad()

    if (!(await fs.existsSync(this._engineDir))) {
      await fs.mkdirSync(this._engineDir).catch((err) => console.debug(err))
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
      const engineFile = join(this._engineDir, this._engineMetadataFileName)
      if (await fs.existsSync(engineFile)) {
        const engine = await fs.readFileSync(engineFile, 'utf-8')
        this._engineSettings =
          typeof engine === 'object' ? engine : JSON.parse(engine)
        this.inferenceUrl = this._engineSettings.full_url
        this.apiKey = this._engineSettings.api_key
      } else {
        await fs.writeFileSync(
          engineFile,
          JSON.stringify(this._engineSettings, null, 2)
        )
      }
    } catch (err) {
      console.error(err)
    }
  }
}
