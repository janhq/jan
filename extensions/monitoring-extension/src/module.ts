const os = require("os");
const path = require("path");
const { readFileSync } = require("fs");
const exec = require("child_process").exec;
const { platform } = require("node:process");

const nodeOsUtils = require("node-os-utils");
const xml = require("xml2js").parseString;

// XML parser options
const options = {
  explicitArray: false,
  trim: true,
};

const checkNvidiaDriverExist = async () => {
  new Promise(async (resolve) => {
    exec("nvidia-smi", (error, stdout, stderr) => {
      if (error) {
        resolve(false);
      }
      resolve(true);
    });
  });
};

const getNvidiaInfo = async () => {
  new Promise((resolve) => {
    exec("nvidia-smi -q -x", (error, stdout, stderr) => {
      if (error) {
        resolve(error);
      }

      if (stderr) {
        resolve(stderr);
      }

      xml(stdout, options, function (err, data) {
        if (err) {
          return resolve(err);
        }
        const json_data = JSON.stringify(data, null, "  ");
        return resolve(json_data);
      });
    });
  });
};

const getCurrentLoad = () =>
  new Promise(async (resolve) => {
    let response = {};
    // Get system RAM information
    nodeOsUtils.mem.used().then(async (ramUsedInfo) => {
      const totalMemory = ramUsedInfo.totalMemMb * 1024 * 1024;
      const usedMemory = ramUsedInfo.usedMemMb * 1024 * 1024;
      response = {
        mem: {
          totalMemory,
          usedMemory,
        },
      };
    });
    // Get CPU information
    nodeOsUtils.cpu.usage().then((cpuPercentage) => {
      response = {
        ...response,
        cpu: {
          usage: cpuPercentage,
        },
      };
    });

    // Get platform specific accelerator information
    if (platform == "darwin") {
      // Check Metal with powermetrics
    } else if (platform == "linux") {
      const hasNvidia = await checkNvidiaDriverExist();
      if (hasNvidia) {
        const nvidiaInfo = await getNvidiaInfo();
        response = {
          ...response,
          nvidia: nvidiaInfo,
        };
      }
    } else if (platform == "win32") {
      const hasNvidia = await checkNvidiaDriverExist();
      if (hasNvidia) {
        const nvidiaInfo = await getNvidiaInfo();
        response = {
          ...response,
          nvidia: nvidiaInfo,
        };
      }
      resolve(response);
    }
  });

module.exports = {
  getCurrentLoad,
};

const test = async () => {
  const test2 = await getCurrentLoad();
  console.log("hehe", test2);
};

test();
