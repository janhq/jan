import Link from 'next/link'
import { Popover, Transition } from '@headlessui/react'
import { Fragment } from 'react'
// import useGetCurrentUser from "@/_hooks/useGetCurrentUser";
import { useSetAtom } from 'jotai'
import { showConfirmSignOutModalAtom } from '@/_helpers/atoms/Modal.atom'

export const MenuHeader: React.FC = () => {
  const setShowConfirmSignOutModal = useSetAtom(showConfirmSignOutModalAtom)
  // const { user } = useGetCurrentUser();

  return <div></div>

  // return (
  //   <Transition
  //     as={Fragment}
  //     enter="transition ease-out duration-200"
  //     enterFrom="opacity-0 translate-y-1"
  //     enterTo="opacity-100 translate-y-0"
  //     leave="transition ease-in duration-150"
  //     leaveFrom="opacity-100 translate-y-0"
  //     leaveTo="opacity-0 translate-y-1"
  //   >
  //     <Popover.Panel className="absolute shadow-profile -right-2 top-full z-10 mt-3 w-[224px] overflow-hidden rounded-[6px] bg-white shadow-lg ring-1 ring-gray-200">
  //       <div className="py-3 px-4 gap-2 flex flex-col">
  //         <h2 className="text-[20px] leading-[25px] tracking-[-0.4px] font-bold text-[#111928]">
  //           {user.displayName}
  //         </h2>
  //         <span className="text-[#6B7280] leading-[17.5px] text-sm">
  //           {user.email}
  //         </span>
  //       </div>
  //       <hr />
  //       <button
  //         onClick={() => setShowConfirmSignOutModal(true)}
  //         className="px-4 py-3 text-sm w-full text-left text-gray-700"
  //       >
  //         Sign Out
  //       </button>
  //       <hr />
  //       <div className="flex gap-2 px-4 py-2 justify-center items-center">
  //         <Link href="/privacy">
  //           <span className="text-[#6B7280] text-xs">Privacy</span>
  //         </Link>
  //         <div className="w-1 h-1 bg-[#D9D9D9] rounded-lg" />
  //         <Link href="/support">
  //           <span className="text-[#6B7280] text-xs">Support</span>
  //         </Link>
  //       </div>
  //     </Popover.Panel>
  //   </Transition>
  // );
}
