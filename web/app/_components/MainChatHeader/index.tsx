import ModelMenu from '../ModelMenu'
import UserToolbar from '../UserToolbar'

const MainChatHeader: React.FC = () => (
  <div className="flex w-full justify-between border-b border-gray-200 px-3 py-1 shadow-sm dark:bg-gray-950">
    <UserToolbar />
    <ModelMenu />
  </div>
)

export default MainChatHeader
