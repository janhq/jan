import Image from "next/image";
import { useSetAtom } from "jotai";
import {
  setMainViewStateAtom,
  MainViewState,
} from "@/_helpers/atoms/MainView.atom";
import SecondaryButton from "../SecondaryButton";

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
        <SecondaryButton
          title={"Explore models"}
          onClick={() => setMainViewState(MainViewState.ExploreModel)}
        />
      </div>
    </div>
  );
};

export default Welcome;
