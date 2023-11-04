import { JanPlugin } from "../plugin";

export interface Model {
  url: string;
  fileName: string;
}

export abstract class ModelPlugin extends JanPlugin {
  abstract downloadModel(): Promise<any[]>;
  abstract deleteModel(): Promise<void>;
  abstract saveModel(): Promise<any>;
  abstract getModels(): Promise<any>;
}
