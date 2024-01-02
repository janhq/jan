const os = require("os");
const osUtils = require("os-utils");

const getResourcesInfo = () =>
  new Promise((resolve) => {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    const response = {
      mem: {
        totalMemory,
        usedMemory,
      },
    };
    resolve(response);
  });

const getCurrentLoad = () =>
  new Promise((resolve) => {
    osUtils.cpuUsage(function(v){
      const cpuPercentage = v * 100;
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
