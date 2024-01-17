import { writeFileSync, existsSync, readFileSync } from "fs";
import { exec } from "child_process";
import path from "path";
import { homedir } from "os";

/**
 * Default GPU settings
 **/
const DEFALT_SETTINGS = {
  notify: true,
  run_mode: "cpu",
  nvidia_driver: {
    exist: false,
    version: "",
  },
  cuda: {
    exist: false,
    version: "",
  },
  gpus: [],
  gpu_highest_vram: "",
};

/**
 * Path to the settings file
 **/
export const NVIDIA_INFO_FILE = path.join(
  homedir(),
  "jan",
  "settings",
  "settings.json"
);

/**
 * Current nitro process
 */
let nitroProcessInfo: NitroProcessInfo | undefined = undefined;

/**
 * Nitro process info
 */
export interface NitroProcessInfo {
  isRunning: boolean
}

/**
 * This will retrive GPU informations and persist settings.json
 * Will be called when the extension is loaded to turn on GPU acceleration if supported
 */
export async function updateNvidiaInfo() {
  if (process.platform !== "darwin") {
    await Promise.all([
      updateNvidiaDriverInfo(),
      updateCudaExistence(),
      updateGpuInfo(),
    ]);
  }
}

/**
 * Retrieve current nitro process
 */
export const getNitroProcessInfo = (subprocess: any): NitroProcessInfo => {
  nitroProcessInfo = {
    isRunning: subprocess != null,
  };
  return nitroProcessInfo;
};

/**
 * Validate nvidia and cuda for linux and windows
 */
export async function updateNvidiaDriverInfo(): Promise<void> {
  exec(
    "nvidia-smi --query-gpu=driver_version --format=csv,noheader",
    (error, stdout) => {
      let data;
      try {
        data = JSON.parse(readFileSync(NVIDIA_INFO_FILE, "utf-8"));
      } catch (error) {
        data = DEFALT_SETTINGS;
      }

      if (!error) {
        const firstLine = stdout.split("\n")[0].trim();
        data["nvidia_driver"].exist = true;
        data["nvidia_driver"].version = firstLine;
      } else {
        data["nvidia_driver"].exist = false;
      }

      writeFileSync(NVIDIA_INFO_FILE, JSON.stringify(data, null, 2));
      Promise.resolve();
    }
  );
}

/**
 * Check if file exists in paths
 */
export function checkFileExistenceInPaths(
  file: string,
  paths: string[]
): boolean {
  return paths.some((p) => existsSync(path.join(p, file)));
}

/**
 * Validate cuda for linux and windows
 */
export function updateCudaExistence() {
  let filesCuda12: string[];
  let filesCuda11: string[];
  let paths: string[];
  let cudaVersion: string = "";

  if (process.platform === "win32") {
    filesCuda12 = ["cublas64_12.dll", "cudart64_12.dll", "cublasLt64_12.dll"];
    filesCuda11 = ["cublas64_11.dll", "cudart64_11.dll", "cublasLt64_11.dll"];
    paths = process.env.PATH ? process.env.PATH.split(path.delimiter) : [];
  } else {
    filesCuda12 = ["libcudart.so.12", "libcublas.so.12", "libcublasLt.so.12"];
    filesCuda11 = ["libcudart.so.11.0", "libcublas.so.11", "libcublasLt.so.11"];
    paths = process.env.LD_LIBRARY_PATH
      ? process.env.LD_LIBRARY_PATH.split(path.delimiter)
      : [];
    paths.push("/usr/lib/x86_64-linux-gnu/");
  }

  let cudaExists = filesCuda12.every(
    (file) => existsSync(file) || checkFileExistenceInPaths(file, paths)
  );

  if (!cudaExists) {
    cudaExists = filesCuda11.every(
      (file) => existsSync(file) || checkFileExistenceInPaths(file, paths)
    );
    if (cudaExists) {
      cudaVersion = "11";
    }
  } else {
    cudaVersion = "12";
  }

  let data;
  try {
    data = JSON.parse(readFileSync(NVIDIA_INFO_FILE, "utf-8"));
  } catch (error) {
    data = DEFALT_SETTINGS;
  }

  data["cuda"].exist = cudaExists;
  data["cuda"].version = cudaVersion;
  if (cudaExists) {
    data.run_mode = "gpu";
  }
  writeFileSync(NVIDIA_INFO_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get GPU information
 */
export async function updateGpuInfo(): Promise<void> {
  exec(
    "nvidia-smi --query-gpu=index,memory.total --format=csv,noheader,nounits",
    (error, stdout) => {
      let data;
      try {
        data = JSON.parse(readFileSync(NVIDIA_INFO_FILE, "utf-8"));
      } catch (error) {
        data = DEFALT_SETTINGS;
      }

      if (!error) {
        // Get GPU info and gpu has higher memory first
        let highestVram = 0;
        let highestVramId = "0";
        let gpus = stdout
          .trim()
          .split("\n")
          .map((line) => {
            let [id, vram] = line.split(", ");
            vram = vram.replace(/\r/g, "");
            if (parseFloat(vram) > highestVram) {
              highestVram = parseFloat(vram);
              highestVramId = id;
            }
            return { id, vram };
          });

        data["gpus"] = gpus;
        data["gpu_highest_vram"] = highestVramId;
      } else {
        data["gpus"] = [];
      }

      writeFileSync(NVIDIA_INFO_FILE, JSON.stringify(data, null, 2));
      Promise.resolve();
    }
  );
}
