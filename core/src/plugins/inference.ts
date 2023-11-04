import { NewMessageRequest } from "../events";
import { JanPlugin } from "../plugin";

export abstract class InferencePlugin extends JanPlugin {
  abstract initModel(modelFileName: string): Promise<void>;
  abstract stopModel(): Promise<void>;
  abstract inferenceRequest(data: NewMessageRequest): Promise<any>
}
