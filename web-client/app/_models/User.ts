import { types } from "mobx-state-tree";

export const User = types.model("User", {
  id: types.string,
  displayName: types.optional(types.string, "Anonymous"),
  avatarUrl: types.maybe(types.string),
  email: types.maybe(types.string),
});

export const DefaultUser = {
  id: "0",
  displayName: "Anonymous",
  avatarUrl: undefined,
  email: "",
};
