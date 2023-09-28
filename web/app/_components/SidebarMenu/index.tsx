import {
  MainViewState,
  getMainViewStateAtom,
  setMainViewStateAtom,
} from "@/_helpers/JotaiWrapper";
import classNames from "classnames";
import { useAtomValue, useSetAtom } from "jotai";
import Image from "next/image";

const SidebarMenu: React.FC = () => {
  const currentState = useAtomValue(getMainViewStateAtom);
  const setMainViewState = useSetAtom(setMainViewStateAtom);

  const menu = [
    {
      name: "Explore Models",
      icon: "Search_gray",
      state: MainViewState.ExploreModel,
    },
    {
      name: "My Models",
      icon: "ViewGrid",
      state: MainViewState.MyModel,
    },
    {
      name: "Settings",
      icon: "Cog",
      state: MainViewState.Setting,
    },
  ];

  const onMenuClick = (state: MainViewState) => {
    if (state === currentState) return;
    setMainViewState(state);
  };

  return (
    <div className="flex flex-col">
      <div className="text-gray-500 text-xs font-semibold py-2 pl-2 pr-3">
        Your Configurations
      </div>
      <ul role="list" className="-mx-2 mt-2 space-y-1">
        {menu.map((item) => (
          <li key={item.name}>
            <button
              onClick={() => onMenuClick(item.state)}
              className={classNames(
                currentState === item.state
                  ? "bg-gray-50 text-indigo-600"
                  : "text-gray-600 hover:text-indigo-600 hover:bg-gray-50",
                "group flex gap-x-3 rounded-md text-base py-2 px-3 w-full"
              )}
            >
              <Image
                src={`/icons/${item.icon}.svg`}
                width={24}
                height={24}
                alt=""
              />
              <span className="truncate">{item.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SidebarMenu;
