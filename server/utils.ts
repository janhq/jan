const path = require("path");
const dataDir = __dirname;
const requiredModules: Record<string, any> = {};
export function appPath(): string {
    return process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share")
}

export async function invokeFunction(modulePath: string, method: string, args: any): Promise<any> {
    console.log(modulePath, method, args);
    const module = require(/* webpackIgnore: true */ path.join(
        dataDir,
        "",
        modulePath
    ));
    requiredModules[modulePath] = module;
    if (typeof module[method] === "function") {
        return module[method](...args);
    } else {
        return Promise.resolve();
    }
}