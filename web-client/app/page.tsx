"use client";
import { ThemeWrapper } from "./_helpers/ThemeWrapper";
import JotaiWrapper from "./_helpers/JotaiWrapper";
import LeftContainer from "./_components/LeftContainer";
import RightContainer from "./_components/RightContainer";
import { ModalWrapper } from "./_helpers/ModalWrapper";
import { useEffect, useState } from "react";

import {
  setup,
  plugins,
  activationPoints,
} from "../node_modules/pluggable-electron/dist/execution.es";

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
        setActivated(true);
      }, 500);
    }
    setupPE();
  }, []);
  return (
    <>
      <JotaiWrapper>
        <ThemeWrapper>
          <ModalWrapper>
            {activated && (
              <div className="flex">
                <LeftContainer />
                <RightContainer />
              </div>
            )}
          </ModalWrapper>
        </ThemeWrapper>
      </JotaiWrapper>
    </>
  );
};

export default Page;
