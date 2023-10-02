import Image from "next/image";
import { SidebarButton } from "../SidebarButton";
import { useSetAtom } from "jotai";
import {
  setMainViewStateAtom,
  MainViewState,
} from "@/_helpers/atoms/MainView.atom";

const Welcome: React.FC = () => {
  const setMainViewState = useSetAtom(setMainViewStateAtom);

  return (
    <div className="flex flex-col h-full">
      <div className="px-[200px] flex-1 flex flex-col gap-5 justify-center items-start">
        <Image src={"icons/Jan_AppIcon.svg"} width={44} height={45} alt="" />
        <span className="font-semibold text-gray-500 text-5xl">
          Welcome,
          <br />
          let’s download your first model
        </span>
        <SidebarButton
          callback={() => setMainViewState(MainViewState.ExploreModel)}
          className="flex flex-row-reverse items-center rounded-lg gap-2 px-3 py-2 text-xs font-medium border border-gray-200"
          icon={"icons/app_icon.svg"}
          title="Explore models"
          height={16}
          width={16}
        />
      </div>
    </div>
  );
};

export default Welcome;
