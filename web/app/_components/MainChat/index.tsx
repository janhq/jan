import ChatBody from '../ChatBody'
import InputToolbar from '../InputToolbar'
import MainChatHeader from '../MainChatHeader'

const MainChat: React.FC = () => (
  <div className="flex h-full w-full flex-col">
    <MainChatHeader />
    <ChatBody />
    <InputToolbar />
  </div>
)

export default MainChat
