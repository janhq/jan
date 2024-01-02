const os = require("os");
const nodeOsUtils = require("node-os-utils");

const getResourcesInfo = () =>
  new Promise((resolve) => {
    nodeOsUtils.mem.used()
      .then(ramUsedInfo => {
        const totalMemory = ramUsedInfo.totalMemMb * 1024 * 1024;
        const usedMemory = ramUsedInfo.usedMemMb * 1024 * 1024;
        const response = {
          mem: {
            totalMemory,
            usedMemory,
          },
        };
        resolve(response);
      })
  });

const getCurrentLoad = () =>
  new Promise((resolve) => {
    nodeOsUtils.cpu.usage().then(cpuPercentage =>{
      const response = {
        cpu: {
          usage: cpuPercentage,
        },
      };
      resolve(response);
    });
  });

module.exports = {
  getResourcesInfo,
  getCurrentLoad,
};
