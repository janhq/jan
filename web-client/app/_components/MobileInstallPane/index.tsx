import Image from "next/image";

const MobileInstallPane: React.FC = () => {
  return (
    <div className="p-4 rounded-[8px] border-[1px] border-[#E5E7EB] bg-[#F9FAFB]">
      <div className="flex flex-col gap-5 items-center">
        <div className="flex flex-col items-center text-[12px]">
          <Image src={"/icons/app_icon.svg"} width={32} height={32} alt="" />
          <h2 className="font-bold leading-[12px] text-center">Jan Mobie</h2>
          <p className="leading-[18px] text-center">
            Stay up to date and move work forward with Jan on iOS & Android.
            <br />
            Download the app today.
          </p>
        </div>
        <div className="flex justify-between items-center gap-3">
          <div className="bg-[#E5E7EB] rounded-[8px] gap-3 p-2 flex items-center">
            <Image src={"/icons/apple.svg"} width={26} height={26} alt="" />
            <div className="flex flex-col">
              <span className="text-[8px] leading-[12px]">Download on the</span>
              <h2 className="font-bold text-[12px] leading-[15px]">AppStore</h2>
            </div>
          </div>
          <div className="bg-[#E5E7EB] rounded-[8px] gap-3 p-2 flex items-center">
            <Image
              src={"/icons/googleplay.svg"}
              width={26}
              height={26}
              alt=""
            />
            <div className="flex flex-col">
              <span className="text-[8px] leading-[12px]">Download on the</span>
              <h2 className="font-bold text-[12px] leading-[15px]">
                Google Play
              </h2>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MobileInstallPane;