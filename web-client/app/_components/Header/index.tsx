"use client";
import React, { useState } from "react";
import { Bars3Icon } from "@heroicons/react/24/outline";
import MobileMenuPane from "../MobileMenuPane";
import ConfirmSignOutModal from "../ConfirmSignOutModal";
import useSignOut from "@/_hooks/useSignOut";
import { ThemeChanger } from "../ChangeTheme";
import UserProfileDropDown from "../UserProfileDropDown";
import useSignIn from "@/_hooks/useSignIn";
import useGetCurrentUser from "@/_hooks/useGetCurrentUser";

const Header: React.FC = () => {
  const { signInWithKeyCloak } = useSignIn();
  const { user, loading } = useGetCurrentUser();
  const { signOut } = useSignOut();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showLogOutModal, setShowLogOutModal] = useState(false);

  return (
    <header
      id="header"
      className="text-sm bg-white border-b-[1px] border-gray-200 relative w-full py-3 px-6 dark:bg-gray-800"
    >
      <nav className="mx-auto flex items-center" aria-label="Global">
        <div className="flex items-center flex-1 justify-center" />

        <div className="hidden md:flex items-center gap-2">
          <ThemeChanger />
          {loading ? (
            <div></div>
          ) : user ? (
            <UserProfileDropDown
              onLogOutClick={() => setShowLogOutModal(true)}
            />
          ) : (
            <button onClick={signInWithKeyCloak}>Login</button>
          )}
        </div>
        <div className="flex lg:hidden">
          <button
            type="button"
            className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700"
            onClick={() => setMobileMenuOpen(true)}
          >
            <span className="sr-only">Open main menu</span>
            <Bars3Icon className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
      </nav>
      <ConfirmSignOutModal
        open={showLogOutModal}
        setOpen={setShowLogOutModal}
        onConfirm={signOut}
      />
      <MobileMenuPane open={mobileMenuOpen} setOpen={setMobileMenuOpen} />
    </header>
  );
};

export default Header;
