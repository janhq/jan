import { types } from "mobx-state-tree";

export const Shortcut = types.model("Shortcut", {
  name: types.string,
  title: types.string,
  avatarUrl: types.string,
});
