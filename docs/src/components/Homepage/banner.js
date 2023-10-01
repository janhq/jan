import React from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { useColorMode } from "@docusaurus/theme-common";

export default function HomepageBanner() {
  const { colorMode } = useColorMode();
  const bannerText =
    "🚧 This site is under construction - expect breaking changes! 🚧";
  return colorMode === "dark" ? (
    <div className="relative isolate flex items-center justify-center overflow-hidden px-6 py-2.5 sm:px-3.5 sm:before:flex-1">
      <strong className="font-semibold text-sm text-white">{bannerText}</strong>
    </div>
  ) : (
    <div className="relative isolate flex items-center justify-center overflow-hidden bg-gray-50 px-6 py-2.5 sm:px-3.5 sm:before:flex-1">
      <div
        className="absolute left-[max(-7rem,calc(50%-52rem))] top-1/2 -z-10 -translate-y-1/2 transform-gpu blur-2xl"
        aria-hidden="true"
      >
        <div
          className="aspect-[577/310] w-[36.0625rem] bg-gradient-to-r from-[#ff80b5] to-[#9089fc] opacity-30"
          style={{
            clipPath:
              "polygon(74.8% 41.9%, 97.2% 73.2%, 100% 34.9%, 92.5% 0.4%, 87.5% 0%, 75% 28.6%, 58.5% 54.6%, 50.1% 56.8%, 46.9% 44%, 48.3% 17.4%, 24.7% 53.9%, 0% 27.9%, 11.9% 74.2%, 24.9% 54.1%, 68.6% 100%, 74.8% 41.9%)",
          }}
        />
      </div>
      <strong className="font-semibold text-sm text-gray-900">
        {bannerText}
      </strong>
    </div>
  );
}
