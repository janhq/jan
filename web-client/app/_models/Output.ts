import { types } from "mobx-state-tree";

export const OutputPropertyModel = types.model("OutputProperty", {
  name: types.string,
  type: types.string,
  description: types.string,
});

export const OutputModel = types.model("Output", {
  slug: types.string,
  type: types.string,
  properties: types.maybeNull(types.array(OutputPropertyModel)),
  description: types.string,
});
