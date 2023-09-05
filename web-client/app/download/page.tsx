"use client";

import { useEffect } from "react";
import { redirect } from "next/navigation";

const Page = () => {
  useEffect(() => {
    var userAgent = navigator.userAgent || navigator.vendor;
    // iOS detection from: http://stackoverflow.com/a/9039885/177710
    if (/iPad|iPhone|iPod/.test(userAgent)) {
      window.open(process.env.NEXT_PUBLIC_DOWNLOAD_APP_IOS, "_blank_");
    } else {
      window.open(process.env.NEXT_PUBLIC_DOWNLOAD_APP_ANDROID, "_blank_");
    }
    redirect("/", undefined);
  }, []);
  return <></>;
};
export default Page;
