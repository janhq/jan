import { ProductDetailFragment } from "@/graphql";
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
}

export function toProduct(
  productDetailFragment: ProductDetailFragment
): Product {
  const {
    id,
    slug,
    name,
    description,
    image_url,
    long_description,
    technical_description,
    author,
    version,
    source_url,
    nsfw,
    greeting,
    created_at,
    updated_at,
  } = productDetailFragment;
  let modelType: ProductType | undefined = undefined;
  if (productDetailFragment.inputs.slug === "llm") {
    modelType = ProductType.LLM;
  } else if (productDetailFragment.inputs.slug === "sd") {
    modelType = ProductType.GenerativeArt;
  } else if (productDetailFragment.inputs.slug === "controlnet") {
    modelType = ProductType.ControlNet;
  } else {
    throw new Error("Model type not supported");
  }

  const product: Product = {
    id,
    slug,
    name,
    description: description ?? "",
    avatarUrl: image_url ?? "icons/app_icon.svg",
    longDescription: long_description ?? "",
    technicalDescription: technical_description ?? "",
    author: author ?? "",
    version: version ?? "",
    modelUrl: source_url ?? "",
    nsfw: nsfw ?? false,
    greeting: greeting ?? "",
    type: modelType,
    createdAt: new Date(created_at).getTime(),
    updatedAt: new Date(updated_at).getTime(),
  };

  return product;
}
