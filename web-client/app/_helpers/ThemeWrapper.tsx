"use client";

import { ThemeProvider } from "next-themes";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export const ThemeWrapper: React.FC<Props> = ({ children }) => {
  return (
    <ThemeProvider enableSystem={false} attribute="class">
      {children}
    </ThemeProvider>
  );
};
