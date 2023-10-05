import { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import React from "react";

export const metadata: Metadata = {
  title: "Support - Jan.ai",
  description: "Support",
};

const Page: React.FC = () => {
  return (
    <div className="flex flex-col text-black items-center h-screen overflow-y-scroll scroll pt-2">
      <div className="absolute top-3 left-5">
        <Link href="/" className="flex flex-row gap-2">
          <div className="flex gap-0.5 items-center">
            <Image src={"icons/app_icon.svg"} width={28} height={28} alt="" />
            <Image src={"icons/Jan.svg"} width={27} height={12} alt="" />
          </div>
        </Link>
      </div>
      <article className="prose lg:prose-xl  my-20">
        <h1>Support </h1>
        <h3>Get fast support in our Discord channel</h3>
        <Link
          className="flex gap-2 cursor-pointer"
          href={process.env.NEXT_PUBLIC_DISCORD_INVITATION_URL ?? "#"}
          target="_blank_"
        >
          <Image src={"icons/discord.svg"} width={70} height={70} alt="" />
        </Link>
        <p>
          If you have any questions or concerns about our privacy policy or
          support services, please contact us at{" "}
          <a href="mailto:hello@jan.ai">hello@jan.ai</a>.
        </p>
      </article>
    </div>
  );
};
export default Page;
