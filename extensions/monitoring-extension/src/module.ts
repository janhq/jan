const si = require("systeminformation");

const getResourcesInfo = async () =>
  new Promise(async (resolve) => {
    const cpu = await si.cpu();
    const mem = await si.mem();
    // const gpu = await si.graphics();
    const response = {
      cpu,
      mem,
      // gpu,
    };
    resolve(response);
  });

const getCurrentLoad = async () =>
  new Promise(async (resolve) => {
    const currentLoad = await si.currentLoad();
    resolve(currentLoad);
  });

module.exports = {
  getResourcesInfo,
  getCurrentLoad,
};
