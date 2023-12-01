import { MessageRequest, ModelSettingParams, ThreadMessage } from "../index";
import { BaseExtension } from "../extension";

/**
 * Inference extension. Start, stop and inference models.
 */
export abstract class InferenceExtension extends BaseExtension {
  /**
   * Initializes the model for the extension.
   * @param modelId - The ID of the model to initialize.
   */
  abstract initModel(modelId: string, settings?: ModelSettingParams): Promise<void>;

  /**
   * Stops the model for the extension.
   */
  abstract stopModel(): Promise<void>;

  /**
   * Stops the streaming inference.
   */
  abstract stopInference(): Promise<void>;

  /**
   * Processes an inference request.
   * @param data - The data for the inference request.
   * @returns The result of the inference request.
   */
  abstract inferenceRequest(data: MessageRequest): Promise<ThreadMessage>;
}
