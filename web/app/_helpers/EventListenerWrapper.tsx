"use client";

import { useSetAtom } from "jotai";
import { ReactNode, useEffect } from "react";
import { modelDownloadStateAtom } from "./JotaiWrapper";
import { DownloadState } from "@/_models/DownloadState";

type Props = {
  children: ReactNode;
};

export default function EventListenerWrapper({ children }: Props) {
  const setDownloadState = useSetAtom(modelDownloadStateAtom);
  useEffect(() => {
    if (window && window.electronAPI) {
      window.electronAPI.onModelDownloadUpdate(
        (event: string, state: DownloadState | undefined) => {
          setDownloadState(state);
        }
      );

      window.electronAPI.onModelDownloadError(() => {
        // TODO: Show error message
      });
    }
  }, []);

  return <div id="eventlistener">{children}</div>;
}
