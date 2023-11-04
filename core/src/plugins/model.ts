import { JanPlugin } from "../plugin";

export abstract class ModelPlugin extends JanPlugin {
  abstract downloadModel(): Promise<any[]>;
  abstract deleteModel(): Promise<void>;
  abstract saveModel(): Promise<any>;
  abstract getModels(): Promise<any>;
}
