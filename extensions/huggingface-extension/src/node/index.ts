import { PythonShell } from 'python-shell'
import { spawn, ChildProcess } from 'child_process'
import { resolve as presolve, join as pjoin } from 'path'
import type { Quantization } from '@janhq/core'
import { log } from '@janhq/core/node'
import { statSync } from 'fs'
export { renameSync } from 'fs'

let pythonShell: PythonShell | undefined = undefined
let quantizeProcess: ChildProcess | undefined = undefined

export const getSize = (path: string): number => statSync(path).size

export const killProcesses = () => {
  if (pythonShell) {
    pythonShell.kill()
    pythonShell = undefined
  }
  if (quantizeProcess) {
    quantizeProcess.kill()
    quantizeProcess = undefined
  }
}

export const getQuantizeExecutable = (): string => {
  let binaryFolder = pjoin(__dirname, '..', 'bin') // Current directory by default
  let binaryName = 'quantize'
  /**
   * The binary folder is different for each platform.
   */
  if (process.platform === 'win32') {
    binaryFolder = pjoin(binaryFolder, 'win')
    binaryName = 'quantize.exe'
  } else if (process.platform === 'darwin') {
    /**
     *  For MacOS: mac-arm64 (Silicon), mac-x64 (InteL)
     */
    if (process.arch === 'arm64') {
      binaryFolder = pjoin(binaryFolder, 'mac-arm64')
    } else {
      binaryFolder = pjoin(binaryFolder, 'mac-x64')
    }
  } else {
    binaryFolder = pjoin(binaryFolder, 'linux-cpu')
  }
  return pjoin(binaryFolder, binaryName)
}

export const installDeps = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    const _pythonShell = new PythonShell(
      presolve(__dirname, '..', 'scripts', 'install_deps.py')
    )
    _pythonShell.on('message', (message) => {
      log(`[Install Deps]::Debug: ${message}`)
    })
    _pythonShell.on('stderr', (stderr) => {
      log(`[Install Deps]::Error: ${stderr}`)
    })
    _pythonShell.on('error', (err) => {
      pythonShell = undefined
      log(`[Install Deps]::Error: ${err}`)
      reject(err)
    })
    _pythonShell.on('close', () => {
      const exitCode = _pythonShell.exitCode
      pythonShell = undefined
      log(
        `[Install Deps]::Debug: Deps installation exited with code: ${exitCode}`
      )
      exitCode === 0 ? resolve() : reject(exitCode)
    })
  })
}

export const convertHf = async (
  modelDirPath: string,
  outPath: string
): Promise<void> => {
  return await new Promise<void>((resolve, reject) => {
    const _pythonShell = new PythonShell(
      presolve(__dirname, '..', 'scripts', 'convert-hf-to-gguf.py'),
      {
        args: [modelDirPath, '--outfile', outPath],
      }
    )
    pythonShell = _pythonShell
    _pythonShell.on('message', (message) => {
      log(`[Conversion]::Debug: ${message}`)
    })
    _pythonShell.on('stderr', (stderr) => {
      log(`[Conversion]::Error: ${stderr}`)
    })
    _pythonShell.on('error', (err) => {
      pythonShell = undefined
      log(`[Conversion]::Error: ${err}`)
      reject(err)
    })
    _pythonShell.on('close', () => {
      const exitCode = _pythonShell.exitCode
      pythonShell = undefined
      if (exitCode !== 0) {
        log(`[Conversion]::Debug: Conversion exited with code: ${exitCode}`)
        reject(exitCode)
      } else {
        resolve()
      }
    })
  })
}

export const convert = async (
  modelDirPath: string,
  outPath: string,
  { ctx, bpe }: { ctx?: number; bpe?: boolean }
): Promise<void> => {
  const args = [modelDirPath, '--outfile', outPath]
  if (ctx) {
    args.push('--ctx')
    args.push(ctx.toString())
  }
  if (bpe) {
    args.push('--vocab-type')
    args.push('bpe')
  }
  return await new Promise<void>((resolve, reject) => {
    const _pythonShell = new PythonShell(
      presolve(__dirname, '..', 'scripts', 'convert.py'),
      {
        args,
      }
    )
    _pythonShell.on('message', (message) => {
      log(`[Conversion]::Debug: ${message}`)
    })
    _pythonShell.on('stderr', (stderr) => {
      log(`[Conversion]::Error: ${stderr}`)
    })
    _pythonShell.on('error', (err) => {
      pythonShell = undefined
      log(`[Conversion]::Error: ${err}`)
      reject(err)
    })
    _pythonShell.on('close', () => {
      const exitCode = _pythonShell.exitCode
      pythonShell = undefined
      if (exitCode !== 0) {
        log(`[Conversion]::Debug: Conversion exited with code: ${exitCode}`)
        reject(exitCode)
      } else {
        resolve()
      }
    })
  })
}

export const quantize = async (
  modelPath: string,
  outPath: string,
  quantization: Quantization
): Promise<void> => {
  return await new Promise<void>((resolve, reject) => {
    const quantizeExecutable = getQuantizeExecutable()
    const _quantizeProcess = spawn(quantizeExecutable, [
      modelPath,
      outPath,
      quantization,
    ])
    quantizeProcess = _quantizeProcess

    _quantizeProcess.stdout?.on('data', (data) => {
      log(`[Quantization]::Debug: ${data}`)
    })
    _quantizeProcess.stderr?.on('data', (data) => {
      log(`[Quantization]::Error: ${data}`)
    })

    _quantizeProcess.on('close', (code) => {
      if (code !== 0) {
        log(`[Quantization]::Debug: Quantization exited with code: ${code}`)
        reject(code)
      } else {
        resolve()
      }
    })
  })
}
