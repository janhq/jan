import { execSync } from 'child_process'

/**
 * Kill process on port util
 * @param port port number to kill
 */
export function killProcessesOnPort(port: number): void {
    try {
      console.log(`Killing processes on port ${port}...`)
      if (process.platform === 'win32') {
        killProcessesOnWindowsPort(port)
      } else {
        killProcessesOnUnixPort(port)
      }
    } catch (error) {
      console.error(
        `Failed to kill process(es) on port ${port}: ${(error as Error).message}`
      )
    }
  }

/**
 * Kill process on port - Windows
 * @param port 
 * @returns 
 */
function killProcessesOnWindowsPort(port: number): void {
    let result: string
    try {
      result = execSync(`netstat -ano | findstr :${port}`).toString()
    } catch (error) {
      console.log(`No processes found on port ${port}.`)
      return
    }
  
    const lines = result.split('\n').filter(Boolean)
  
    if (lines.length === 0) {
      console.log(`No processes found on port ${port}.`)
      return
    }
  
    const pids = lines
      .map((line) => {
        const parts = line.trim().split(/\s+/)
        return parts[parts.length - 1]
      })
      .filter((pid): pid is string => Boolean(pid) && !isNaN(Number(pid)))
  
    if (pids.length === 0) {
      console.log(`No valid PIDs found for port ${port}.`)
      return
    }
    const uniquePids = Array.from(new Set(pids))
    console.log('uniquePids', uniquePids)
  
    uniquePids.forEach((pid) => {
      try {
        execSync(`taskkill /PID ${pid} /F`)
        console.log(
          `Process with PID ${pid} on port ${port} has been terminated.`
        )
      } catch (error) {
        console.error(
          `Failed to kill process with PID ${pid}: ${(error as Error).message}`
        )
      }
    })
  }
  
  /**
   * Kill process on port - Unix
   * @param port 
   * @returns 
   */
  function killProcessesOnUnixPort(port: number): void {
    let pids: string[]
  
    try {
      pids = execSync(`lsof -ti tcp:${port}`)
        .toString()
        .trim()
        .split('\n')
        .filter(Boolean)
    } catch (error) {
      if ((error as { status?: number }).status === 1) {
        console.log(`No processes found on port ${port}.`)
        return
      }
      throw error // Re-throw if it's not the "no processes found" error
    }
  
    pids.forEach((pid) => {
      process.kill(parseInt(pid), 'SIGTERM')
      console.log(`Process with PID ${pid} on port ${port} has been terminated.`)
    })
  }