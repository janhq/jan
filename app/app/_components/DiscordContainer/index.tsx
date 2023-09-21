import React from "react";
import Link from "next/link";
import Image from "next/image";

const DiscordContainer = () => (
  <div className="border-t border-gray-200 p-3 gap-3 flex items-center justify-between">
    <Link
      className="flex gap-2 items-center rounded-lg text-gray-900 text-xs leading-[18px]"
      href="/download"
      target="_blank_"
    >
      <Image
        src={"icons/ico_mobile-android.svg"}
        width={16}
        height={16}
        alt=""
      />
      Get the app
    </Link>
    <Link
      className="flex items-center rounded-lg text-purple-700 text-xs leading-[18px] font-semibold gap-2"
      href={process.env.NEXT_PUBLIC_DISCORD_INVITATION_URL ?? "#"}
      target="_blank_"
    >
      <Image src={"icons/ico_Discord.svg"} width={20} height={20} alt="" />
      Discord
    </Link>
  </div>
);

export default React.memo(DiscordContainer);
