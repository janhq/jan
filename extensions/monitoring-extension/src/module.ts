const si = require("systeminformation");
const { platform } = require('node:process');
const { exec } = require('child_process');

const plist = require('plist');

const checkNvidiaDriver = async () => {
  new Promise(async (resolve) => {
    exec('nvidia-smi', (error, stdout, stderr) => {
      if (error) {
          resolve(false)
      }
      resolve(true)
    });
  })
}

const countMacOsGpuCores = async () => {
  new Promise(async (resolve) => {
    exec('system_profiler -detailLevel basic SPDisplaysDataType | grep "Total Number of Cores"', (error, stdout, stderr) => {
      if (error) {
          resolve(error)
      }
      const gpu_cores = parseInt(stdout.split(": ")[-1])
      resolve(gpu_cores)
    });
  })
}

const parseMacOsPowermetrics = () => {
  return new Promise((resolve, reject) => {
    exec('sudo powermetrics --samplers gpu_power,ane_power -n1 -i200 --format plist', (error, stdout, stderr) => {
      if (error) {
        resolve(error);
      }
      const powermetrics = plist.parse(stdout);
      const gpu_metrics = powermetrics.gpu;
      console.log('gpu_metrics', gpu_metrics);
      resolve(gpu_metrics);
    });
  });
}

const getResourcesInfo = async () =>
  new Promise(async (resolve) => {
    const cpu = await si.cpu();
    const mem = await si.mem();
    let response = {
      cpu,
      mem,
    };
    if (platform == 'darwin') {
      try {
        const powerMetrics = await parseMacOsPowermetrics();
        console.log('powermetrics', powerMetrics);
        const extra = {
          isSilicon: true,
          gpu_ane: powerMetrics,
        };
        response = { ...response, ...extra };
      } catch (error) {
        console.error('Error getting power metrics:', error);
      }
    }
    if (platform == 'win32'){
      const hasNvidia = await checkNvidiaDriver()
      const extra = {
        hasNvidia: hasNvidia,
      }
      // TODO: Add NVIDIA monitoring here
      response = {...response, ...extra}
    }
    if (platform == 'linux'){
      const hasNvidia = await checkNvidiaDriver()
      const extra = {
        hasNvidia: hasNvidia,
      }
      // TODO: Add NVIDIA monitoring here
      response = {...response, ...extra}    
    }
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

const test = async () => {
  const data = await getResourcesInfo()
  console.log(data)
}

// test()