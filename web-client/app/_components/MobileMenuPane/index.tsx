import React from "react";
import { Dialog } from "@headlessui/react";
import {  XMarkIcon,
          PlusSmallIcon } from "@heroicons/react/24/outline";
import Image from "next/image";

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const MobileMenuPane: React.FC<Props> = ({ open, setOpen }) => (
  <Dialog as="div" className="md:hidden" open={open} onClose={setOpen}>
    <div className="fixed inset-0 z-10" />
    <Dialog.Panel className="fixed inset-y-0 right-0 z-10 w-full overflow-y-auto bg-white px-4 py-4 sm:max-w-sm sm:ring-1 sm:ring-gray-900/10">
      
      {/* Dialog Header */}
      <div className="flex items-center justify-between">
        
        {/* Close Menu Button */}
        <button
          type="button"
          className="rounded-md text-gray-700"
          onClick={() => setOpen(false)}
        >
          <span className="sr-only">Close menu</span>
          <XMarkIcon className="h-6 w-6" aria-hidden="true" />
        </button>

        {/* Jan Logo */}
        <a href="#">
          <span className="sr-only">Your Company</span>
          <Image
            className="h-8 w-auto"
            width={32}
            height={32}
            src="/icons/app_icon_logoonly.svg"
            alt="jan_logo"
          />
        </a>
        
        
      </div>

      {/* Dialog Body */}
      <div className="mt-2 flow-root px-2 py-2">
         {/* New Chat Button */}
         <button
              type="button"
              className="inline-flex w-full items-center gap-x-1.5 rounded-md bg-white ring-1 px-3 py-2 text-sm ring-gray-300 hover:bg-gray-50">
                
              <PlusSmallIcon className="-ml-0.5 h-5 w-5" aria-hidden="true" />
              New Chat
            </button>
        <div className="-my-6 divide-y divide-gray-500/10">
          <div className="space-y-2 py-6"/>
          <div className="py-6">
            <a
              href="#"
              className="-mx-3 block rounded-lg px-3 py-2.5 text-base font-semibold leading-7 text-gray-900 hover:bg-gray-50"
            >Log in
            </a>
          </div>
        </div>
      </div>

    </Dialog.Panel>
  </Dialog>
);

export default MobileMenuPane;
