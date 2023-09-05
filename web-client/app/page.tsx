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
          <div className="flex w-full h-screen">
            <div className="flex h-screen z-100">
              <SidebarLeft />
              <CompactSideBar />
              <AdvancedPrompt />
            </div>
            <div className="w-full max-h-screen flex-1 flex flex-col">
              <div className="flex-shrink-0 flex-0">
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
