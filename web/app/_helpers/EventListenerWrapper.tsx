"use client";

import { useSetAtom } from "jotai";
import { ReactNode, useEffect } from "react";
import {
  setDownloadStateAtom,
  setDownloadStateSuccessAtom,
} from "./JotaiWrapper";
import { DownloadState } from "@/_models/DownloadState";
import { execute } from "../../../electron/core/plugin-manager/execution/extension-manager";
import { DataService } from "../../shared/coreService";

type Props = {
  children: ReactNode;
};

export default function EventListenerWrapper({ children }: Props) {
  const setDownloadState = useSetAtom(setDownloadStateAtom);
  const setDownloadStateSuccess = useSetAtom(setDownloadStateSuccessAtom);
  useEffect(() => {
    if (window && window.electronAPI) {
      window.electronAPI.onFileDownloadUpdate(
        (_event: string, state: DownloadState | undefined) => {
          if (!state) return;
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
          if (callback && callback.fileName) {
            setDownloadStateSuccess(callback.fileName);
            execute(
              DataService.UPDATE_FINISHED_DOWNLOAD,
              callback.fileName,
            );
          }
        }
      );
    }
  }, []);

  return <div id="eventlistener">{children}</div>;
}
