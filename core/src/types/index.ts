export interface Conversation {
  _id: string;
  modelId?: string;
  botId?: string;
  name: string;
  message?: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
  messages: Message[];
}
export interface Message {
  message?: string;
  user?: string;
  _id: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Model {
  /**
   * Combination of owner and model name.
   * Being used as file name. MUST be unique.
   */
  _id: string;
  name: string;
  quantMethod: string;
  bits: number;
  size: number;
  maxRamRequired: number;
  usecase: string;
  downloadLink: string;
  modelFile?: string;
  /**
   * For tracking download info
   */
  startDownloadAt?: number;
  finishDownloadAt?: number;
  productId: string;
  productName: string;
  shortDescription: string;
  longDescription: string;
  avatarUrl: string;
  author: string;
  version: string;
  modelUrl: string;
  createdAt: number;
  updatedAt?: number;
  status: string;
  releaseDate: number;
  tags: string[];
}
export interface ModelCatalog {
  _id: string;
  name: string;
  shortDescription: string;
  avatarUrl: string;
  longDescription: string;
  author: string;
  version: string;
  modelUrl: string;
  createdAt: number;
  updatedAt?: number;
  status: string;
  releaseDate: number;
  tags: string[];
  availableVersions: ModelVersion[];
}
/**
 * Model type which will be stored in the database
 */
export type ModelVersion = {
  /**
   * Combination of owner and model name.
   * Being used as file name. Should be unique.
   */
  _id: string;
  name: string;
  quantMethod: string;
  bits: number;
  size: number;
  maxRamRequired: number;
  usecase: string;
  downloadLink: string;
  productId: string;
  /**
   * For tracking download state
   */
  startDownloadAt?: number;
  finishDownloadAt?: number;
};
