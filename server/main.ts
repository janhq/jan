import express, { Express, Request, Response, NextFunction } from 'express'
import cors from "cors";
import { resolve } from "path";
const fs = require("fs");
const progress = require("request-progress");
const path = require("path");
const request = require("request");

// Create app dir
const userDataPath = appPath();
if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath);

interface ProgressState {
  percent?: number;
  speed?: number;
  size?: {
    total: number;
    transferred: number;
  };
  time?: {
    elapsed: number;
    remaining: number;
  };
  success?: boolean | undefined;
  fileName: string;
}

const options: cors.CorsOptions = { origin: "*" };
const requiredModules: Record<string, any> = {};
const port = process.env.PORT || 4000;
const dataDir = __dirname;
type DownloadProgress = Record<string, ProgressState>;
const downloadProgress: DownloadProgress = {};
const app: Express = express()
app.use(express.static(dataDir + '/renderer'))
app.use(cors(options))
app.use(express.json());

/**
 * Execute a plugin module function via API call
 *
 * @param     modulePath     path to module name to import
 * @param     method         function name to execute. The methods "deleteFile" and "downloadFile" will call the server function {@link deleteFile}, {@link downloadFile} instead of the plugin function.
 * @param     args           arguments to pass to the function
 * @returns   Promise<any>
 *
 */
app.post('/api/v1/invokeFunction', (req: Request, res: Response, next: NextFunction): void => {
  const method = req.body["method"];
  const args = req.body["args"];
  switch (method) {
    case "deleteFile":
      deleteFile(args).then(() => res.json(Object())).catch((err: any) => next(err));
      break;
    case "downloadFile":
      downloadFile(args.downloadUrl, args.fileName).then(() => res.json(Object())).catch((err: any) => next(err));
      break;
    default:
      const result = invokeFunction(req.body["modulePath"], method, args)
      if (typeof result === "undefined") {
        res.json(Object())
      } else {
        result?.then((result: any) => {
          res.json(result)
        }).catch((err: any) => next(err));
      }
  }
});

app.post('/api/v1/downloadProgress', (req: Request, res: Response): void => {
  const fileName = req.body["fileName"];
  if (fileName && downloadProgress[fileName]) {
    res.json(downloadProgress[fileName])
    return;
  } else {
    const obj = downloadingFile();
    if (obj) {
      res.json(obj)
      return;
    }
  }
  res.json(Object());
});

app.use((err: Error, req: Request, res: Response, next: NextFunction): void => {
  console.error("ErrorHandler", req.url, req.body, err);
  res.status(500);
  res.json({ error: err?.message ?? "Internal Server Error" })
});

app.listen(port, () => console.log(`Application is running on port ${port}`));


async function invokeFunction(modulePath: string, method: string, args: any): Promise<any> {
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

function downloadModel(downloadUrl: string, fileName: string): void {
  const userDataPath = appPath();
  const destination = resolve(userDataPath, fileName);
  console.log("Download file", fileName, "to", destination);
  progress(request(downloadUrl), {})
    .on("progress", function (state: any) {
      downloadProgress[fileName] = {
        ...state,
        fileName,
        success: undefined
      };
      console.log("downloading file", fileName, (state.percent * 100).toFixed(2) + '%');
    })
    .on("error", function (err: Error) {
      downloadProgress[fileName] = {
        ...downloadProgress[fileName],
        success: false,
        fileName: fileName,
      };
    })
    .on("end", function () {
      downloadProgress[fileName] = {
        success: true,
        fileName: fileName,
      };
    })
    .pipe(fs.createWriteStream(destination));
}

function deleteFile(filePath: string): Promise<void> {
  const userDataPath = appPath();
  const fullPath = resolve(userDataPath, filePath);
  return new Promise((resolve, reject) => {
    fs.unlink(fullPath, function (err: any) {
      if (err && err.code === "ENOENT") {
        reject(Error(`File does not exist: ${err}`));
      } else if (err) {
        reject(Error(`File delete error: ${err}`));
      } else {
        console.log(`Delete file ${filePath} from ${fullPath}`)
        resolve();
      }
    });
  })
}

function downloadingFile(): ProgressState | undefined {
  const obj = Object.values(downloadProgress).find(obj => obj && typeof obj.success === "undefined")
  return obj
}


async function downloadFile(downloadUrl: string, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const obj = downloadingFile();
    if (obj) {
      reject(Error(obj.fileName + " is being downloaded!"))
      return;
    };
    (async () => {
      downloadModel(downloadUrl, fileName);
    })().catch(e => {
      console.error("downloadModel", fileName, e);
    });
    resolve();
  });
}

function appPath(): string {
  return process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share")
}