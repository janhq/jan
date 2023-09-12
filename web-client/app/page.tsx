import { ApolloWrapper } from "./_helpers/ApolloWrapper";
import { ThemeWrapper } from "./_helpers/ThemeWrapper";
import JotaiWrapper from "./_helpers/JotaiWrapper";
import LeftContainer from "./_components/LeftContainer";
import RightContainer from "./_components/RightContainer";
import { ModalWrapper } from "./_helpers/ModalWrapper";

const Page: React.FC = () => (
  <ApolloWrapper>
    <JotaiWrapper>
      <ThemeWrapper>
        <ModalWrapper>
          <div className="flex">
            <LeftContainer />
            <RightContainer />
          </div>
        </ModalWrapper>
      </ThemeWrapper>
    </JotaiWrapper>
  </ApolloWrapper>
);

export default Page;
