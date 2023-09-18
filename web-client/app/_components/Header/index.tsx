import React from "react";
import UserProfileDropDown from "../UserProfileDropDown";
import LoginButton from "../LoginButton";
import HamburgerButton from "../HamburgerButton";
import { CogIcon } from "@heroicons/react/24/outline";
import Link from "next/link";

const Header: React.FC = () => {
  return (
    <header className="flex border-b-[1px] border-gray-200 p-3 dark:bg-gray-800">
      <nav className="flex-1 justify-center">
        <HamburgerButton />
      </nav>
      <Link href="/settings">
        <CogIcon width={30} height={30} />
      </Link>
      <LoginButton />
      <UserProfileDropDown />
    </header>
  );
};

export default Header;
