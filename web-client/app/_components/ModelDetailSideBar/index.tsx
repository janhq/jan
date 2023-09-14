import { showingProductDetailAtom } from "@/_atoms/ModalAtoms";
import OverviewPane from "../OverviewPane";
import { useAtomValue } from "jotai";

const ModelDetailSideBar: React.FC = () => {
  const showingProductDetail = useAtomValue(showingProductDetailAtom);
  if (!showingProductDetail) return <div />;
  return (
    <div className="flex w-[473px] h-full border-l-[1px] border-[#E5E7EB]">
      <OverviewPane />
    </div>
  );
};

export default ModelDetailSideBar;
