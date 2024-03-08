import { clipboard, globalShortcut } from "electron";
import { keyTap, keys } from "@hurdlegroup/robotjs";

/**
 * Gets selected text by synthesizing the keyboard shortcut
 * "CommandOrControl+c" then reading text from the clipboard
 */
export const getSelectedText = async () => {
  const currentClipboardContent = clipboard.readText(); // preserve clipboard content
  clipboard.clear();
  keyTap("c" as keys, process.platform === "darwin" ? "command" : "control");
  await new Promise((resolve) => setTimeout(resolve, 200)); // add a delay before checking clipboard
  const selectedText = clipboard.readText();
  clipboard.writeText(currentClipboardContent);
  return selectedText;
};

/**
 * Registers a global shortcut of `accelerator`. The `callback` is called
 * with the selected text when the registered shorcut is pressed by the user
 *
 * Returns `true` if the shortcut was registered successfully
 */
export const registerShortcut = (
  accelerator: Electron.Accelerator,
  callback: (selectedText: string) => void
) => {
  return globalShortcut.register(accelerator, async () => {
    callback(await getSelectedText());
  });
};

/**
 * Unregisters a global shortcut of `accelerator` and
 * is equivalent to electron.globalShortcut.unregister
 */
export const unregisterShortcut = (accelerator: Electron.Accelerator) => {
  globalShortcut.unregister(accelerator);
};