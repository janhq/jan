const os = require("os");
const path = require("path");
const { readFileSync } = require("fs");
const exec = require("child_process").exec;
const { platform } = require("node:process");

const nodeOsUtils = require("node-os-utils");

const checkNvidiaDriverExist = () => {
  return new Promise(async (resolve, reject) => {
    exec("nvidia-smi", (error, stdout, stderr) => {
      console.log(stdout);
      if (error) {
        resolve(false);
      }
      resolve(true);
    });
  });
};

const getNvidiaInfo = () => {
  return new Promise((resolve, reject) => {
    exec(
      "nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.total,memory.free,utilization.memory --format=csv,noheader",
      (error, stdout, stderr) => {
        if (error) {
          resolve(error);
        }

        if (stderr) {
          resolve(stderr);
        }
        // TODO: @hien please help with multi GPU parser
        const dataLine = stdout.split("\n")[0].trim().split(", ");
        const json_data = {
          name: dataLine[0],
          temperature: parseInt(dataLine[1]),
          gpu_utilization: parseInt(dataLine[2].replace(/[^0-9]/g, "")),
          vram_total: parseInt(dataLine[3].replace(/[^0-9]/g, "")),
          vram_free: parseInt(dataLine[4].replace(/[^0-9]/g, "")),
          vram_utilization: parseInt(dataLine[5].replace(/[^0-9]/g, "")),
        };
        resolve(json_data);
      }
    );
  });
};

const getCurrentLoad = () =>
  new Promise(async (resolve) => {
    const response = {
      cpu: {
        usage: undefined,
      },
      mem: {
        totalMemory: undefined,
        usedMemory: undefined,
      },
      nvidia: undefined,
    };

    // Get system RAM information
    const ramInfo = await nodeOsUtils.mem.used();
    response.mem.totalMemory = ramInfo.totalMemMb * 1024 * 1024;
    response.mem.usedMemory = ramInfo.usedMemMb * 1024 * 1024;

    // Get CPU information
    const cpuPercentage = await nodeOsUtils.cpu.usage();
    response.cpu.usage = cpuPercentage;

    // Get platform specific accelerator information
    if (platform == "darwin") {
      // Check Metal with powermetrics
    } else if (platform == "linux") {
      const hasNvidia = await checkNvidiaDriverExist();
      if (hasNvidia) {
        const nvidiaInfo = await getNvidiaInfo();
        response.nvidia = nvidiaInfo;
      }
    } else if (platform == "win32") {
      const hasNvidia = await checkNvidiaDriverExist();
      if (hasNvidia) {
        const nvidiaInfo = await getNvidiaInfo();
        response.nvidia = nvidiaInfo;
      }

      console.log("response gpu", response);

      resolve(response);
    }
  });

module.exports = {
  getCurrentLoad,
};
