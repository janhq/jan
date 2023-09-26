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
      window.electronAPI.onFileDownloadUpdate(
        (_event: string, state: DownloadState | undefined) => {
          setDownloadState(state);
        }
      );

      window.electronAPI.onFileDownloadError(
        (_event: string, callback: any) => {
          console.log("Download error", callback);
        }
      );

      window.electronAPI.onFileDownloadSuccess(
        (_event: string, callback: any) => {
          console.log("Download success", callback);
        }
      );
    }
  }, []);

  return <div id="eventlistener">{children}</div>;
}
