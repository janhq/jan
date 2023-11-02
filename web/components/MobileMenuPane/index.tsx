import React, { useRef } from 'react'

import Image from 'next/image'

import { Dialog } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useAtom } from 'jotai'

import { showingMobilePaneAtom } from '@/helpers/atoms/Modal.atom'

const MobileMenuPane: React.FC = () => {
  const [show, setShow] = useAtom(showingMobilePaneAtom)
  const loginRef = useRef(null)

  return (
    <Dialog
      as="div"
      open={show}
      initialFocus={loginRef}
      onClose={() => setShow(false)}
    >
      <div className="fixed inset-0 z-10" />
      <Dialog.Panel className="fixed inset-y-0 right-0 z-10 w-full overflow-y-auto bg-white px-6 py-6 sm:max-w-sm sm:ring-1 sm:ring-gray-900/10">
        <div className="flex items-center justify-between">
          <a href="#" className="-m-1.5 p-1.5">
            <span className="sr-only">Your Company</span>
            <Image
              className="h-8 w-auto"
              width={32}
              height={32}
              src="icons/app_icon.svg"
              alt=""
            />
          </a>
          <button
            type="button"
            className="-m-2.5 rounded-md p-2.5 text-gray-700"
            onClick={() => setShow(false)}
          >
            <span className="sr-only">Close menu</span>
            <XMarkIcon className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-6 flow-root">
          <div className="-my-6 divide-y divide-gray-500/10">
            <div className="space-y-2 py-6" />
            <div className="py-6">
              <a
                ref={loginRef}
                href="#"
                className="-mx-3 block rounded-lg px-3 py-2.5 text-base font-semibold leading-7 text-gray-900 hover:bg-gray-50"
              >
                Log in
              </a>
            </div>
          </div>
        </div>
      </Dialog.Panel>
    </Dialog>
  )
}

export default MobileMenuPane
