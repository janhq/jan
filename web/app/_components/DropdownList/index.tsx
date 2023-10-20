import { Fragment, useState } from 'react'
import { Menu, Transition } from '@headlessui/react'
import Image from 'next/image'

function classNames(...classes: any) {
  return classes.filter(Boolean).join(' ')
}

type Props = {
  title: string
  data: string[]
}

export const DropdownsList: React.FC<Props> = ({ data, title }) => {
  const [checked, setChecked] = useState(data[0])

  return (
    <Menu as="div" className="relative w-full text-left">
      <div className="flex flex-col gap-2 pt-2">
        <h2 className="text-sm text-[#111928]">{title}</h2>
        <Menu.Button className="inline-flex w-full items-center justify-between gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
          {checked}
          <Image
            src={'icons/unicorn_angle-down.svg'}
            width={12}
            height={12}
            alt=""
          />
        </Menu.Button>
      </div>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 z-10 mt-2 w-full origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
          <div className="py-1">
            {data.map((item, index) => (
              <Menu.Item key={index}>
                {({ active }) => (
                  <a
                    onClick={() => setChecked(item)}
                    href="#"
                    className={classNames(
                      active ? 'bg-gray-100 text-gray-900' : 'text-gray-700',
                      'block px-4 py-2 text-sm'
                    )}
                  >
                    {item}
                  </a>
                )}
              </Menu.Item>
            ))}
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  )
}
