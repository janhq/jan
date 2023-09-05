import Image from "next/image";
import Link from "next/link";

// DEPRECATED
export default function Footer() {
  return (
    <div className="flex items-center justify-between container m-auto">
      <div className="flex items-center gap-3">
        <Image src={"/icons/app_icon.svg"} width={32} height={32} alt="" />
        <span>Jan</span>
      </div>
      <div className="flex gap-4 my-6">
        <Link
          href="/privacy"
          className="cursor-pointer"
        >
          Privacy
        </Link>
        <span>&#8226;</span>
        <Link
          href="/support"
          className="cursor-pointer"
        >
          Support
        </Link>
      </div>
    </div>
  );
}
