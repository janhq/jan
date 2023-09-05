"use client";

import { Provider, initializeStore } from "@/_models/RootStore";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export const MobxWrapper: React.FC<Props> = ({ children }) => {
  const store = initializeStore();
  return <Provider value={store}>{children}</Provider>;
};
