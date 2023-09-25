import React from "react";
import Image from "next/image";

const MobileDownload = () => {
  return (
    <div className="flex items-center flex-col box-border rounded-lg border border-gray-200 p-4 bg-[#F9FAFB] mb-3">
      {/** Jan logo */}
      <Image
        src="icons/janai_logo.svg"
        alt={""}
        width={32}
        height={32}
        style={{ objectFit: "contain" }}
      />
      <b>Jan Mobile</b>
      {/** Messages */}
      <p className="font-light text-[12px] text-center">
        Stay up to date and move work forward with Jan on iOS & Android.
        Download the app today.
      </p>
      {/** Buttons */}
      <div className="flex w-full mt-4 justify-between">
        <a
          href={process.env.NEXT_PUBLIC_DOWNLOAD_APP_IOS || ""}
          target="_blank"
          rel="noopener noreferrer"
          className="w-[48%]"
        >
          <div className="flex box-border h-11 rounded-md bg-gray-300 p-2 items-center hover:bg-gray-200 focus:bg-gray-600">
            <Image
              src="icons/social_icon_apple.svg"
              alt={""}
              width={26}
              height={26}
              style={{ objectFit: "contain" }}
            />
            <div className="ml-1">
              <p className="text-[8px]">Download on the</p>
              <p className="text-[10px] font-bold">AppStore</p>
            </div>
          </div>
        </a>

        <a
          href={process.env.NEXT_PUBLIC_DOWNLOAD_APP_ANDROID || ""}
          target="_blank"
          rel="noopener noreferrer"
          className="w-[48%]"
        >
          <div className="flex box-border h-11 rounded-md bg-gray-300 p-2 items-center hover:bg-gray-200 focus:bg-gray-600">
            <Image
              src="icons/google_play_logo.svg"
              alt={""}
              width={26}
              height={26}
              style={{ objectFit: "contain" }}
            />
            <div className="ml-1">
              <p className="text-[8px]">Download on the</p>
              <p className="text-[10px] font-bold">Google Play</p>
            </div>
          </div>
        </a>
      </div>
    </div>
  );
};

export default React.memo(MobileDownload);
