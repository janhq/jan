import { PythonShell } from 'python-shell'
import { resolve as presolve } from 'path'

let pythonShell: PythonShell | undefined = undefined

export const killPythonShell = () => {
  if (pythonShell) {
    pythonShell.kill()
    pythonShell = undefined
  }
}

export const installDeps = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    pythonShell = new PythonShell(
      presolve(__dirname, '..', '..', 'scripts', 'install_deps.py')
    )
    pythonShell.on('error', (err) => {
      pythonShell = undefined
      reject(err)
    })
    pythonShell.on('close', () => {
      pythonShell.exitCode === 0 ? resolve() : reject()
    })
  })
}

// export const convert = (modelPath: string) => {}
