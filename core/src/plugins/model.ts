import { JanPlugin } from "../plugin";
import { Model, ModelCatalog } from "../types/index";

export abstract class ModelPlugin extends JanPlugin {
  abstract downloadModel(model: Model): Promise<void>;
  abstract deleteModel(filePath: string): Promise<void>;
  abstract saveModel(model: Model): Promise<void>;
  abstract getDownloadedModels(): Promise<Model[]>;
  abstract getConfiguredModels(): Promise<ModelCatalog[]>;
}
