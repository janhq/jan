import Image from "next/image";
import { useState } from "react";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import js from "react-syntax-highlighter/dist/esm/languages/hljs/javascript";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import useGetModelApiInfo from "@/_hooks/useGetModelApiInfo";

SyntaxHighlighter.registerLanguage("javascript", js);

const ApiPane: React.FC = () => {
  const [expend, setExpend] = useState(true);
  const { data } = useGetModelApiInfo();
  const [highlightCode, setHighlightCode] = useState(data[0]);

  return (
    <div className="h-full flex flex-col relative">
      <div className="absolute top-0 left-0 h-full w-full overflow-x-hidden scroll">
        <button
          onClick={() => setExpend(!expend)}
          className="flex items-center flex-none"
        >
          <Image
            src={"icons/unicorn_angle-down.svg"}
            width={24}
            height={24}
            alt=""
          />
          <span>Request</span>
        </button>
        <div
          className={`${
            expend ? "block" : "hidden"
          } bg-[#1F2A37] rounded-lg w-full flex-1`}
        >
          <div className="p-2 flex justify-between flex-1">
            <div className="flex">
              {data.map((item, index) => (
                <button
                  className={`py-1 text-xs text-[#9CA3AF] px-2 flex gap-[10px] rounded ${
                    highlightCode?.type === item.type
                      ? "bg-[#374151] text-white"
                      : ""
                  }`}
                  key={index}
                  onClick={() => setHighlightCode(item)}
                >
                  {item.type}
                </button>
              ))}
            </div>
            <button
              onClick={() =>
                navigator.clipboard.writeText(highlightCode?.stringCode)
              }
            >
              <Image
                src={"icons/unicorn_clipboard-alt.svg"}
                width={24}
                height={24}
                alt=""
              />
            </button>
          </div>
          <SyntaxHighlighter
            className="w-full bg-transparent overflow-x-hidden scroll resize-none"
            language="jsx"
            style={atomOneDark}
            customStyle={{ padding: "12px", background: "transparent" }}
            wrapLongLines={true}
          >
            {highlightCode?.stringCode}
          </SyntaxHighlighter>
        </div>
      </div>
    </div>
  );
};

export default ApiPane;