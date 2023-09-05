import { types } from "mobx-state-tree";

export const InputHeaderModel = types.model("InputHeader", {
  accept: types.maybeNull(types.string),
  contentType: types.maybeNull(types.string),
});

export const InputBodyModel = types.model("InputBody", {
  name: types.string,
  type: types.string,
  example: types.maybeNull(types.string),
  description: types.string,
});

export const InputModel = types.model("Input", {
  slug: types.string,
  header: InputHeaderModel,
  body: types.array(InputBodyModel),
});
