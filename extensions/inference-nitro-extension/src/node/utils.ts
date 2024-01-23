import os from "os";
import childProcess from "child_process";

function exec(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.exec(command, { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

let amount: number;
const platform = os.platform();

export async function physicalCpuCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (platform === "linux") {
      exec('lscpu -p | egrep -v "^#" | sort -u -t, -k 2,4 | wc -l')
        .then((output) => {
          amount = parseInt(output.trim(), 10);
          resolve(amount);
        })
        .catch(reject);
    } else if (platform === "darwin") {
      exec("sysctl -n hw.physicalcpu_max")
        .then((output) => {
          amount = parseInt(output.trim(), 10);
          resolve(amount);
        })
        .catch(reject);
    } else if (platform === "win32") {
      exec("WMIC CPU Get NumberOfCores")
        .then((output) => {
          amount = output
            .split(os.EOL)
            .map((line: string) => parseInt(line))
            .filter((value: number) => !isNaN(value))
            .reduce((sum: number, number: number) => sum + number, 0);
          resolve(amount);
        })
        .catch(reject);
    } else {
      const cores = os.cpus().filter((cpu: any, index: number) => {
        const hasHyperthreading = cpu.model.includes("Intel");
        const isOdd = index % 2 === 1;
        return !hasHyperthreading || isOdd;
      });
      amount = cores.length;
      resolve(amount);
    }
  });
}
