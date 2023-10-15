"use client";

import { ThemeWrapper } from "./_helpers/ThemeWrapper";
import JotaiWrapper from "./_helpers/JotaiWrapper";
import { ModalWrapper } from "./_helpers/ModalWrapper";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
  setup,
  plugins,
  activationPoints,
} from "../../electron/core/plugin-manager/execution/index";
import {
  isCorePluginInstalled,
  setupBasePlugins,
} from "./_services/pluginService";
import EventListenerWrapper from "./_helpers/EventListenerWrapper";
import { setupCoreServices } from "./_services/coreService";
import MainContainer from "./_components/MainContainer";

const Page: React.FC = () => {
  const [activated, setActivated] = useState(false);

  // Services Setup
  useEffect(() => {
    // Setup Core Service
    setupCoreServices();

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
            {activated ? (
              <MainContainer />
            ) : (
              <div className="bg-white w-screen h-screen items-center justify-center flex">
                <Image width={50} height={50} src="icons/app_icon.svg" alt="" />
              </div>
            )}
          </ModalWrapper>
        </ThemeWrapper>
      </EventListenerWrapper>
    </JotaiWrapper>
  );
};

export default Page;
