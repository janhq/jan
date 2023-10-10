import { Menu, Transition } from "@headlessui/react";
import { EllipsisVerticalIcon } from "@heroicons/react/20/solid";
import { Fragment } from "react";

type Props = {
  onDeleteClick: () => void;
};

const ModelActionMenu: React.FC<Props> = ({ onDeleteClick }) => (
  <Menu as="div" className="relative flex-none">
    <Menu.Button className="block text-gray-500 hover:text-gray-900">
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
      <Menu.Items className="absolute right-0 z-50 mt-2 w-32 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-gray-900/5 focus:outline-none">
        <Menu.Item>
          {({ active }) => (
            <button
              className={`${
                active ? "bg-violet-500 text-white" : "text-gray-900"
              } group flex w-full items-center rounded-md px-2 py-2 text-sm`}
              onClick={onDeleteClick}
            >
              Delete
            </button>
          )}
        </Menu.Item>
      </Menu.Items>
    </Transition>
  </Menu>
);

export default ModelActionMenu;
