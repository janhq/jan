import { Assistant } from "../index";
import { JanPlugin } from "../plugin";

/**
 * Abstract class for assistant plugins.
 * @extends JanPlugin
 */
export abstract class AssistantPlugin extends JanPlugin {
  abstract createAssistant(assistant: Assistant): Promise<void>;

  abstract deleteAssistant(assistant: Assistant): Promise<void>;

  abstract getAssistants(): Promise<Assistant[]>;
}
