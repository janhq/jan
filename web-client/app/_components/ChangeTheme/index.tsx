import { useTheme } from "next-themes";
import { SunIcon, MoonIcon } from "@heroicons/react/24/outline";

export const ThemeChanger: React.FC = () => {
  const { theme, setTheme, systemTheme } = useTheme();
  const currentTheme = theme === "system" ? systemTheme : theme;

  if (currentTheme === "dark") {
    return (
      <SunIcon
        className="h-6 w-6"
        aria-hidden="true"
        onClick={() => setTheme("light")}
      />
    );
  }

  return (
    <MoonIcon
      className="h-6 w-6"
      aria-hidden="true"
      onClick={() => setTheme("dark")}
    />
  );
};
