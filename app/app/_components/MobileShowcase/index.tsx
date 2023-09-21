import Image from "next/image";
import Link from "next/link";
import React from "react";

const MobileShowcase = () => {
  return (
    <div className="md:hidden flex flex-col px-5 mt-10 items-center justify-center w-full gap-10">
      <Image
        src="images/mobile.jpg"
        width={638}
        height={892}
        alt="mobile"
        className="w-full h-full"
        style={{ objectFit: "contain" }}
      />
      <div className="flex flex-col items-center justify-center mb-20">
        <Image
          src="icons/app_icon.svg"
          width={200}
          height={200}
          className="w-[10%]"
          alt="logo"
        />
        <span className="text-[22px] font-semibold">Download Jan App</span>
        <p className="text-center text-sm text-gray-500">
          <span>Stay up to date and move work forward with Jan on iOS</span>
          <span>& Android. Download the app today.</span>
        </p>
        <div className="flex justify-between items-center gap-3 mt-5">
          <a
            href={process.env.NEXT_PUBLIC_DOWNLOAD_APP_IOS ?? "#"}
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
            href={process.env.NEXT_PUBLIC_DOWNLOAD_APP_ANDROID ?? "#"}
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
        <Link
          href={process.env.NEXT_PUBLIC_DISCORD_INVITATION_URL ?? "#"}
          target="_blank_"
        >
          <div className="flex flex-row space-x-2 items-center justify-center rounded-[18px] px-2 h-[36px] bg-[#E2E5FF] mt-5">
            <Image
              src="icons/discord-icon.svg"
              width={24}
              height={24}
              className=""
              alt=""
            />
            <span className="text-[#5865F2]">Join our Discord Community</span>
          </div>
        </Link>
      </div>
    </div>
  );
};

export default MobileShowcase;
