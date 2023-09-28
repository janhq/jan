"use client";

import { useAtomValue } from "jotai";
import { MainViewState, getMainViewStateAtom } from "@/_helpers/JotaiWrapper";
import { ReactNode } from "react";
import ModelManagement from "../ModelManagement";
import Welcome from "../WelcomeContainer";
import { Preferences } from "../Preferences";

type Props = {
  children: ReactNode;
};

export default function ChatContainer({ children }: Props) {
  const viewState = useAtomValue(getMainViewStateAtom);

  switch (viewState) {
    case MainViewState.ExploreModel:
      return <ModelManagement />;
    case MainViewState.Setting:
      return <Preferences />;
    case MainViewState.ResourceMonitor:
    case MainViewState.MyModel:
    case MainViewState.Welcome:
      return <Welcome />;
    default:
      return <div className="flex flex-1 overflow-hidden">{children}</div>;
  }
}
