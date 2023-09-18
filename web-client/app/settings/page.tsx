import { Preferences } from "@/_components/Preferences";
import Link from "next/link";

const Settings = () => {
  return (
    <div className="flex">
      <Link href="/">Back</Link>
      <Preferences />
    </div>
  );
};

export default Settings;
