"use client";

import { ThemeWrapper } from "./_helpers/ThemeWrapper";
import JotaiWrapper from "./_helpers/JotaiWrapper";
import RightContainer from "./_components/RightContainer";
import { ModalWrapper } from "./_helpers/ModalWrapper";
import { useEffect, useState } from "react";

import {
  setup,
  plugins,
  activationPoints,
} from "../../electron/core/plugin-manager/execution/index";
import {
  isCorePluginInstalled,
  setupBasePlugins,
} from "./_services/pluginService";
import LeftContainer from "./_components/LeftContainer";
import EventListenerWrapper from "./_helpers/EventListenerWrapper";

const Page: React.FC = () => {
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    async function setupPE() {
      // Enable activation point management
      setup({
        importer: (plugin: string) =>
          import(/* webpackIgnore: true */ plugin).catch((err) => {
            console.log(err);
          }),
      });

      // Register all active plugins with their activation points
      await plugins.registerActive();
      setTimeout(async () => {
        // Trigger activation points
        await activationPoints.trigger("init");
        if (!isCorePluginInstalled()) {
          alert(
            "It seems like you don't have all required plugins installed. To use this app, please install all required plugins."
          );
          setupBasePlugins();
          return;
        }
        setActivated(true);
      }, 500);
    }
    // Electron
    if (window && window.electronAPI) {
      setupPE();
    } else {
      // Host
      setActivated(true);
    }
  }, []);

  return (
    <JotaiWrapper>
      <EventListenerWrapper>
        <ThemeWrapper>
          <ModalWrapper>
            {activated && (
              <div className="flex">
                <LeftContainer />
                <RightContainer />
              </div>
            )}
            {!activated && (
              <img
                className="w-screen h-screen object-cover"
                alt=""
                src="images/banner.jpg"
              />
            )}
          </ModalWrapper>
        </ThemeWrapper>
      </EventListenerWrapper>
    </JotaiWrapper>
  );
};

export default Page;
