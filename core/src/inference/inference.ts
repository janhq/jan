import { MessageRequest, ModelSettingParams, ThreadMessage } from "../index";
import { BaseExtension } from "../extension";

/**
 * Inference extension. Start, stop and inference models.
 */
export abstract class InferenceExtension extends BaseExtension {
  /**
   * Processes an inference request.
   * @param data - The data for the inference request.
   * @returns The result of the inference request.
   */
  abstract inference(data: MessageRequest): Promise<ThreadMessage>;
}
