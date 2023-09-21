import ModelMenu from "../ModelMenu";
import UserToolbar from "../UserToolbar";

const MainChatHeader: React.FC = () => (
  <div className="flex w-full px-3 justify-between py-1 border-b border-gray-200 shadow-sm dark:bg-gray-950">
    <UserToolbar />
    <ModelMenu />
  </div>
);

export default MainChatHeader;
