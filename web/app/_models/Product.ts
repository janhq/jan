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

  accelerated?: boolean; // TODO: add this in the database
  totalSize?: number; // TODO: add this in the database
  format?: string; // TODO: add this in the database // GGUF or something else
  status?: string; // TODO: add this in the database // Downloaded, Active
}
