import "./globals.css";
import { Inter } from "next/font/google";
import classNames from "classnames";
import MobileShowcase from "@/_components/MobileShowcase";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProviderWrapper>
      <html lang="en">
        <body
          className={classNames(
            inter.className,
            "flex flex-col w-full h-screen"
          )}
        >
          <div className="hidden md:flex flex-col w-full h-screen">
            {children}
          </div>
          <MobileShowcase />
        </body>
      </html>
    </SessionProviderWrapper>
  );
}
