"use client";

import { useAtomValue } from "jotai";
import Welcome from "../WelcomeContainer";
import { Preferences } from "../Preferences";
import MyModelContainer from "../MyModelContainer";
import ExploreModelContainer from "../ExploreModelContainer";
import {
  MainViewState,
  getMainViewStateAtom,
} from "@/_helpers/atoms/MainView.atom";
import EmptyChatContainer from "../EmptyChatContainer";
import MainChat from "../MainChat";

export default function ChatContainer() {
  const viewState = useAtomValue(getMainViewStateAtom);

  switch (viewState) {
    case MainViewState.ConversationEmptyModel:
      return <EmptyChatContainer />;
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
      return <MainChat />;
  }
}
