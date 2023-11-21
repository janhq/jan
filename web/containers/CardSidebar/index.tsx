import { ReactNode, useState } from 'react'
import { Fragment } from 'react'
import { Menu, Transition } from '@headlessui/react'
import {
  ChevronDownIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/20/solid'

interface Props {
  children: ReactNode
  title: string
  onRevealInFinderClick: (type: string) => void
  onViewJsonClick: (type: string) => void
}

function classNames(...classes: any) {
  return classes.filter(Boolean).join(' ')
}

export default function CardSidebar({
  children,
  title,
  onRevealInFinderClick,
  onViewJsonClick,
}: Props) {
  const [show, setShow] = useState(true)

  return (
    <div className="flex w-full flex-col">
      <div className="flex items-center rounded-lg border border-border">
        <button
          onClick={() => setShow(!show)}
          className="flex w-full flex-1 items-center py-2"
        >
          <ChevronDownIcon
            className={`h-5 w-5 flex-none text-gray-400 ${
              show && 'rotate-180'
            }`}
          />
          <span className="text-xs uppercase">{title}</span>
        </button>
        <Menu as="div" className="relative flex-none">
          <Menu.Button className="-m-2.5 block p-2.5 text-gray-500 hover:text-gray-900">
            <span className="sr-only">Open options</span>
            <EllipsisVerticalIcon className="h-5 w-5" aria-hidden="true" />
          </Menu.Button>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <Menu.Items className="absolute right-0 z-10 mt-2 w-32 origin-top-right rounded-md bg-white py-2 shadow-lg ring-1 ring-gray-900/5 focus:outline-none">
              <Menu.Item>
                {({ active }) => (
                  <a
                    onClick={() => onRevealInFinderClick(title)}
                    className={classNames(
                      active ? 'bg-gray-50' : '',
                      'block cursor-pointer px-3 py-1 text-xs leading-6 text-gray-900'
                    )}
                  >
                    Reveal in finder
                  </a>
                )}
              </Menu.Item>
              <Menu.Item>
                {({ active }) => (
                  <a
                    onClick={() => onViewJsonClick(title)}
                    className={classNames(
                      active ? 'bg-gray-50' : '',
                      'block cursor-pointer px-3 py-1 text-xs leading-6 text-gray-900'
                    )}
                  >
                    View a JSON
                  </a>
                )}
              </Menu.Item>
            </Menu.Items>
          </Transition>
        </Menu>
      </div>
      {show && <div className="flex flex-col gap-2 p-2">{children}</div>}
    </div>
  )
}
