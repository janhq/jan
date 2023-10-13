import { ModelVersion } from "./ModelVersion";
import { ProductInput } from "./ProductInput";
import { ProductOutput } from "./ProductOutput";

export enum ProductType {
  LLM = "LLM",
  GenerativeArt = "GenerativeArt",
  ControlNet = "ControlNet",
}

export interface Product {
  id: string;
  name: string;
  shortDescription: string;
  avatarUrl: string;
  longDescription: string;
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
  status: string;
  releaseDate: number;
  tags: string[];
  availableVersions: ModelVersion[];
}
