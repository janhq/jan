import {
  InferenceEngine,
  Engines,
  EngineVariant,
  EngineReleased,
  EngineConfig,
  DefaultEngineVariant,
  Model,
} from '../../types'
import { BaseExtension, ExtensionTypeEnum } from '../extension'

/**
 * Engine management extension. Persists and retrieves engine management.
 * @abstract
 * @extends BaseExtension
 */
export abstract class EngineManagementExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.Engine
  }

  /**
   * @returns A Promise that resolves to an object of list engines.
   */
  abstract getEngines(): Promise<Engines>

  /**
   * @param name - Inference engine name.
   * @returns A Promise that resolves to an array of installed engine.
   */
  abstract getInstalledEngines(name: InferenceEngine): Promise<EngineVariant[]>

  /**
   * @param name - Inference engine name.
   * @param version - Version of the engine.
   * @param platform - Optional to sort by operating system. macOS, linux, windows.
   * @returns A Promise that resolves to an array of latest released engine by version.
   */
  abstract getReleasedEnginesByVersion(
    name: InferenceEngine,
    version: string,
    platform?: string
  ): Promise<EngineReleased[]>

  /**
   * @param name - Inference engine name.
   * @param platform - Optional to sort by operating system. macOS, linux, windows.
   * @returns A Promise that resolves to an array of latest released engine.
   */
  abstract getLatestReleasedEngine(
    name: InferenceEngine,
    platform?: string
  ): Promise<EngineReleased[]>

  /**
   * @param name - Inference engine name.
   * @returns A Promise that resolves to intall of engine.
   */
  abstract installEngine(
    name: string,
    engineConfig: EngineConfig
  ): Promise<{ messages: string }>

  /**
   * Add a new remote engine
   * @returns A Promise that resolves to intall of engine.
   */
  abstract addRemoteEngine(
    engineConfig: EngineConfig
  ): Promise<{ messages: string }>

  /**
   * @param name - Inference engine name.
   * @returns A Promise that resolves to unintall of engine.
   */
  abstract uninstallEngine(
    name: InferenceEngine,
    engineConfig: EngineConfig
  ): Promise<{ messages: string }>

  /**
   * @param name - Inference engine name.
   * @returns A Promise that resolves to an object of default engine.
   */
  abstract getDefaultEngineVariant(
    name: InferenceEngine
  ): Promise<DefaultEngineVariant>

  /**
   * @body variant - string
   * @body version - string
   * @returns A Promise that resolves to set default engine.
   */
  abstract setDefaultEngineVariant(
    name: InferenceEngine,
    engineConfig: EngineConfig
  ): Promise<{ messages: string }>

  /**
   * @returns A Promise that resolves to update engine.
   */
  abstract updateEngine(
    name: InferenceEngine,
    engineConfig?: EngineConfig
  ): Promise<{ messages: string }>

  /**
   * Add a new remote model for a specific engine
   */
  abstract addRemoteModel(model: Model): Promise<void>

  /**
   * @returns A Promise that resolves to an object of remote models list .
   */
  abstract getRemoteModels(name: InferenceEngine | string): Promise<any>
}
