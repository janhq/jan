import CompactHistoryList from "../CompactHistoryList";
import CompactLogo from "../CompactLogo";

const CompactSideBar: React.FC = () => (
  <div className="h-screen w-16 border-r border-gray-300 flex flex-col items-center pt-3 gap-3">
    <CompactLogo />
    <CompactHistoryList />
  </div>
);

export default CompactSideBar;
