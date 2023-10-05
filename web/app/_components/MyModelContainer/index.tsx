import HeaderTitle from "../HeaderTitle";
import DownloadedModelTable from "../DownloadedModelTable";
import ActiveModelTable from "../ActiveModelTable";
import DownloadingModelTable from "../DownloadingModelTable";

const MyModelContainer: React.FC = () => (
  <div className="flex flex-col flex-1 pt-[60px]">
    <HeaderTitle title="My Models" className="pl-[63px] pr-[89px]" />
    <div className="pb-6 overflow-y-auto scroll">
      <ActiveModelTable />
      <DownloadingModelTable />
      <DownloadedModelTable />
    </div>
  </div>
);

export default MyModelContainer;
