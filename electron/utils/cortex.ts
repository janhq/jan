import { killProcessesOnPort } from './process'

// Cortex server configurations
export const cortexJsPort = 1338
export const cortexCppPort = 3940
export const cortexHost = '127.0.0.1'

/**
 * Kills all possible running cortex processes
 */
export async function cleanCortexProcesses() {
  await killProcessesOnPort(cortexCppPort)
  await killProcessesOnPort(cortexJsPort)
}

/**
 * Stops the cortex API server
 */
export async function stopCortexApiServer() {
  // this function is not meant to be success. It will throw an error.
  try {
    await fetch(`http://${cortexHost}:${cortexJsPort}/v1/system`, {
      method: 'DELETE',
    })
  } catch (error) {
    // Do nothing
    // Accept failure here
  }
}
