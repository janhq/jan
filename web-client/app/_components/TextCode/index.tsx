import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import Image from "next/image";

type Props = {
  text: string;
};

export const TextCode: React.FC<Props> = ({ text }) => (
  <div className="w-full rounded-lg overflow-hidden bg-[#1F2A37] mr-3">
    <div className="text-gray-200 bg-gray-800 flex items-center justify-between px-4 py-2 text-xs capitalize">
      <button onClick={() => navigator.clipboard.writeText(text)}>
        <Image
          src={"/icons/unicorn_clipboard-alt.svg"}
          width={24}
          height={24}
          alt=""
        />
      </button>
    </div>
    <SyntaxHighlighter
      className="w-full overflow-x-hidden resize-none"
      language="jsx"
      style={atomOneDark}
      customStyle={{ padding: "12px", background: "transparent" }}
      wrapLongLines={true}
    >
      {text}
    </SyntaxHighlighter>
  </div>
);
