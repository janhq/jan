import { readFileSync } from "fs";
import * as path from "path";
import { NVIDIA_INFO_FILE } from "./nvidia";

export interface NitroExecutableOptions {
  executablePath: string;
  cudaVisibleDevices: string;
}
/**
 * Find which executable file to run based on the current platform.
 * @returns The name of the executable file to run.
 */
export const executableNitroFile = (): NitroExecutableOptions => {
  let binaryFolder = path.join(__dirname, "..", "bin"); // Current directory by default
  let cudaVisibleDevices = "";
  let binaryName = "nitro";
  /**
   * The binary folder is different for each platform.
   */
  if (process.platform === "win32") {
    /**
     *  For Windows: win-cpu, win-cuda-11-7, win-cuda-12-0
     */
    let nvidiaInfo = JSON.parse(readFileSync(NVIDIA_INFO_FILE, "utf-8"));
    if (nvidiaInfo["run_mode"] === "cpu") {
      binaryFolder = path.join(binaryFolder, "win-cpu");
    } else {
      if (nvidiaInfo["cuda"].version === "11") {
        binaryFolder = path.join(binaryFolder, "win-cuda-11-7");
      } else {
        binaryFolder = path.join(binaryFolder, "win-cuda-12-0");
      }
      cudaVisibleDevices = nvidiaInfo["gpus_in_use"].join(",");
    }
    binaryName = "nitro.exe";
  } else if (process.platform === "darwin") {
    /**
     *  For MacOS: mac-arm64 (Silicon), mac-x64 (InteL)
     */
    if (process.arch === "arm64") {
      binaryFolder = path.join(binaryFolder, "mac-arm64");
    } else {
      binaryFolder = path.join(binaryFolder, "mac-x64");
    }
  } else {
    /**
     *  For Linux: linux-cpu, linux-cuda-11-7, linux-cuda-12-0
     */
    let nvidiaInfo = JSON.parse(readFileSync(NVIDIA_INFO_FILE, "utf-8"));
    if (nvidiaInfo["run_mode"] === "cpu") {
      binaryFolder = path.join(binaryFolder, "linux-cpu");
    } else {
      if (nvidiaInfo["cuda"].version === "11") {
        binaryFolder = path.join(binaryFolder, "linux-cuda-11-7");
      } else {
        binaryFolder = path.join(binaryFolder, "linux-cuda-12-0");
      }
      cudaVisibleDevices = nvidiaInfo["gpus_in_use"].join(",");
    }
  }
  return {
    executablePath: path.join(binaryFolder, binaryName),
    cudaVisibleDevices,
  };
};
