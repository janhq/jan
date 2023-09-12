import Header from "@/_components/Header";
import { AdvancedPrompt } from "@/_components/AdvancedPrompt";
import ChatContainer from "@/_components/ChatContainer";
import { CompactSideBar } from "@/_components/CompactSideBar";
import { SidebarLeft } from "@/_components/SidebarLeft";
import { ApolloWrapper } from "./_helpers/ApolloWrapper";
import { MobxWrapper } from "./_helpers/MobxWrapper";
import { ThemeWrapper } from "./_helpers/ThemeWrapper";

const Page: React.FC = () => {
  return (
    <ApolloWrapper>
      <MobxWrapper>
        <ThemeWrapper>
          <div className="flex grow h-100">
            <div className="flex w-80 hidden lg:flex">
              <SidebarLeft />
            </div>
            <div className="w-full max-h-screen flex-1 flex flex-col">
              <div className="flex lg:hidden">
                <Header />
              </div>
              <ChatContainer />
            </div>
          </div>
        </ThemeWrapper>
      </MobxWrapper>
    </ApolloWrapper>
  );
};

export default Page;
