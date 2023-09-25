"use client";

import { ThemeProvider } from "next-themes";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

// consider to use next-themes or not. This caused the error Warning: Extra attributes from the server: class,style at html after hydration
export const ThemeWrapper: React.FC<Props> = ({ children }) => (
  <ThemeProvider enableSystem={false} attribute="class">
    {children}
  </ThemeProvider>
);
