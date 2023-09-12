import "./globals.css";
import { Inter } from "next/font/google";
import classNames from "classnames";
import { Metadata } from "next";
import SessionProviderWrapper from "@/_components/SessionProviderWrapper";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Jan",
  description:
    "Self-hosted, local, AI Inference Platform that scales from personal use to production deployments for a team.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_WEB_URL ?? "https://cloud.jan.ai"
  ),
  openGraph: {
    images: "/images/preview.jpg",
  },
};

type Props = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: Props) {
  return (
    <SessionProviderWrapper>
      {/* suppressHydrationWarning is for next-themes */}
      <html lang="en" suppressHydrationWarning> 
        <body className={classNames(inter.className)}>{children}</body>
      </html>
    </SessionProviderWrapper>
  );
}
