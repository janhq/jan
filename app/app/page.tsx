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
} from "../electron/core/plugin-manager/execution/index";
import {
  isCorePluginInstalled,
  setupBasePlugins,
} from "./_services/pluginService";
import LeftContainer2 from "./_components/LeftContainer2";

const Page: React.FC = () => {
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    async function setupPE() {
      // Enable activation point management
      setup({
        //@ts-ignore
        importer: (plugin) =>
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
    setupPE();
  }, []);
  return (
    <JotaiWrapper>
      <ThemeWrapper>
        <ModalWrapper>
          {activated && (
            <div className="flex">
              <LeftContainer2 />
              <RightContainer />
            </div>
          )}
          {!activated && (
            <>
              <img
                className="w-full h-full object-cover"
                alt=""
                src="images/banner.jpg"
              ></img>
            </>
          )}
        </ModalWrapper>
      </ThemeWrapper>
    </JotaiWrapper>
  );
};

export default Page;
