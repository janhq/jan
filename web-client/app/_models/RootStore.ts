import { createContext, useContext } from "react";
import { Instance, types } from "mobx-state-tree";
import { History } from "./History";
import { values } from "mobx";

export const RootStore = types
  .model("RootStore", {
    historyStore: types.optional(History, {}),
  })
  .views((self) => ({
    get activeConversationId() {
      return values(self.historyStore.activeConversationId);
    },

    get conversations() {
      return values(self.historyStore.conversations);
    },
  }));

export function initializeStore(): RootInstance {
  const _store: RootInstance = RootStore.create({});

  return _store;
}

export type RootInstance = Instance<typeof RootStore>;
const RootStoreContext = createContext<null | RootInstance>(null);
export const Provider = RootStoreContext.Provider;

export function useStore(): Instance<typeof RootStore> {
  const store = useContext(RootStoreContext);
  if (store === null) {
    throw new Error("Store cannot be null, please add a context provider");
  }
  return store;
}
