import { JanPlugin } from "../plugin";
import { Model } from "../types/index";

export abstract class ModelPlugin extends JanPlugin {
  abstract downloadModel(model: Model): Promise<void>;
  abstract deleteModel(filePath: string): Promise<void>;
  abstract saveModel(model: Model): Promise<void>;
  abstract getModels(): Promise<Model[]>;
}
