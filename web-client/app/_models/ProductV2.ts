// Should change name to Product after we remove the old one
import { AiModelType } from "../_models/Product";

export interface Collection {
  id: number;
  created_at: string;
  updated_at: string | undefined;
  deleted_at: string | undefined;
  slug: CollectionType;
  name: string;
  description: string;
  products: ProductV2[];
}

export interface ProductV2 {
  id: number;
  created_at: string;
  updated_at: string | undefined;
  deleted_at: string | undefined;
  slug: string;

  name: string;
  nsfw: boolean;
  image_url: string;
  description: string;
  long_description: string;

  technical_description: string;
  author: string;
  version: string;
  source_url: string;
  collections: Collection[];

  prompts: Prompt[] | undefined;
  inputs: InputResponse;
  outputs: Record<string, unknown>;
  greeting: string;
  modelType: AiModelType;
}

export interface OutputResponse {}

export interface InputProperty {
  name: string;
  type: string;
  example: string;
  description: string;
}

export interface InputBody {
  name: string;
  type: string; // TODO make enum for this
  items: InputArrayItem[] | undefined;
  example: unknown;
  description: string;
}

export interface InputArrayItem {
  type: string;
  properties: InputProperty[];
}

export interface InputResponse {
  body: InputBody[];
  slug: string;
  headers: Record<string, string>;
}

export interface Prompt {
  id: number;
  created_at: string;
  updated_at: string | undefined;
  deleted_at: string | undefined;
  slug: string;

  content: string;
  image_url: string | undefined;
  products: ProductV2[] | undefined;
}

export type CollectionType = "conversational" | "text-to-image";
