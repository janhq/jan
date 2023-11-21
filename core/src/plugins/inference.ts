import { MessageRequest, ThreadMessage } from "../index";
import { JanPlugin } from "../plugin";

/**
 * An abstract class representing an Inference Plugin for Jan.
 */
export abstract class InferencePlugin extends JanPlugin {
  /**
   * Initializes the model for the plugin.
   * @param modelFileName - The name of the file containing the model.
   */
  abstract initModel(modelFileName: string): Promise<void>;

  /**
   * Stops the model for the plugin.
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
