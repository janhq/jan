// @ts-nocheck
"use client";

import { useSetAtom } from "jotai";
import { ReactNode, useEffect } from "react";
import { modelDownloadStateAtom } from "./JotaiWrapper";

type Props = {
  children: ReactNode;
};

export default function EventListenerWrapper({ children }: Props) {
  const setDownloadState = useSetAtom(modelDownloadStateAtom);
  useEffect(() => {
    if (window && window.electronAPI) {
      window.electronAPI.onModelDownloadUpdate((event, state) => {
        setDownloadState(state);
      });

      window.electronAPI.onModelDownloadError(() => {
        // TODO: Show error message
      });
    }
  }, []);

  return <div id="eventlistener">{children}</div>;
}
