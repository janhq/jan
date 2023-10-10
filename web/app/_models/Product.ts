import { ProductInput } from "./ProductInput";
import { ProductOutput } from "./ProductOutput";

export enum ProductType {
  LLM = "LLM",
  GenerativeArt = "GenerativeArt",
  ControlNet = "ControlNet",
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  avatarUrl: string;
  longDescription: string;
  technicalDescription: string;
  author: string;
  version: string;
  modelUrl: string;
  nsfw: boolean;
  greeting: string;
  type: ProductType;
  inputs?: ProductInput;
  outputs?: ProductOutput;
  createdAt: number;
  updatedAt?: number;
  fileName?: string;
  downloadUrl?: string;

  accelerated: boolean; // TODO: add this in the database
  totalSize: number; // TODO: add this in the database
  format: string; // TODO: add this in the database // GGUF or something else
  status: string; // TODO: add this in the database // Downloaded, Active
  releaseDate: number; // TODO: add this in the database

  availableVersions: ModelVersion[];
}

export interface ModelVersion {
  /**
   * Act as the id of the model version
   */
  path: string;

  /**
   * currently, we only have `file` type
   */
  type: string;

  /**
   * The download url for the model version
   */
  downloadUrl: string;

  /**
   * File size in bytes
   */
  size: number;
}
