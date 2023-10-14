import { ProductType } from "./Product";

/**
 * Represent a model
 */
export type AssistantModel = {
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

  nsfw: boolean;

  greeting: string;

  type: ProductType;

  createdAt: number;

  updatedAt?: number;

  status: string;

  releaseDate: number;

  tags: string[];
};
