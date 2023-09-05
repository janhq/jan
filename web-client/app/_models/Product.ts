import { types } from "mobx-state-tree";
import { InputModel } from "./Input";
import { OutputModel } from "./Output";

export enum AiModelType {
  LLM = "LLM",
  GenerativeArt = "GenerativeArt",
  ControlNet = "ControlNet",
}

export const Product = types.model("Product", {
  id: types.string, // TODO change to slug
  name: types.string,
  type: types.enumeration(Object.values(AiModelType)),
  description: types.maybeNull(types.string),
  avatarUrl: types.maybeNull(types.string),
  modelVersion: types.maybeNull(types.string),
  modelUrl: types.maybeNull(types.string),
  modelDescription: types.maybeNull(types.string),
  input: types.maybeNull(InputModel),
  output: types.maybeNull(OutputModel),
});
