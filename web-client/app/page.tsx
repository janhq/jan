"use client";
import { ApolloWrapper } from "./_helpers/ApolloWrapper";
import { ThemeWrapper } from "./_helpers/ThemeWrapper";
import JotaiWrapper from "./_helpers/JotaiWrapper";
import LeftContainer from "./_components/LeftContainer";
import RightContainer from "./_components/RightContainer";
import { ModalWrapper } from "./_helpers/ModalWrapper";
import { useEffect } from "react";
import { Preferences } from "./_components/Preferences";
import dynamic from "next/dynamic";
import Head from "next/head";
import {
  setup,
  plugins,
} from "../node_modules/pluggable-electron/dist/execution.es.js";
const Page: React.FC = () => {
  useEffect(() => {
    async function setupPE() {
      // Enable activation point management
      setup({
        importer: (plugin) =>
          //@ts-ignore
          import(/* webpackIgnore: true */ plugin).catch((err) => {
            console.log(err);
          }),
      });

      // Register all active plugins with their activation points
      await plugins.registerActive();
    }
    setupPE();
  });

  return (
    <>
      <ApolloWrapper>
        <JotaiWrapper>
          <ThemeWrapper>
            <ModalWrapper>
              <div className="flex">
                <LeftContainer />
                <RightContainer />
              </div>
            </ModalWrapper>
          </ThemeWrapper>
        </JotaiWrapper>
      </ApolloWrapper>
      {/* <>{typeof window !== "undefined" ? <Preferences /> : <></>}</> */}
    </>
  );
};

export default Page;
