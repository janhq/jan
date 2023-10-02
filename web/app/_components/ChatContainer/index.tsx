"use client";

import { useAtomValue } from "jotai";
import { ReactNode } from "react";
import Welcome from "../WelcomeContainer";
import { Preferences } from "../Preferences";
import MyModelContainer from "../MyModelContainer";
import ExploreModelContainer from "../ExploreModelContainer";
import {
  MainViewState,
  getMainViewStateAtom,
} from "@/_helpers/atoms/MainView.atom";

type Props = {
  children: ReactNode;
};

export default function ChatContainer({ children }: Props) {
  const viewState = useAtomValue(getMainViewStateAtom);

  switch (viewState) {
    case MainViewState.ExploreModel:
      return <ExploreModelContainer />;
    case MainViewState.Setting:
      return <Preferences />;
    case MainViewState.ResourceMonitor:
    case MainViewState.MyModel:
      return <MyModelContainer />;
    case MainViewState.Welcome:
      return <Welcome />;
    default:
      return <div className="flex flex-1 overflow-hidden">{children}</div>;
  }
}
