"use client";

import { Provider, atom } from "jotai";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default function JotaiWrapper({ children }: Props) {
  return <Provider>{children}</Provider>;
}
