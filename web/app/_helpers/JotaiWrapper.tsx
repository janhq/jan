"use client";

import { Provider, atom } from "jotai";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default function JotaiWrapper({ children }: Props) {
  return <Provider>{children}</Provider>;
}

export const currentPromptAtom = atom<string>("");

export const appDownloadProgress = atom<number>(-1);
export const searchingModelText = atom<string>("");

export const searchAtom = atom<string>("");

export const modelSearchAtom = atom<string>("");
