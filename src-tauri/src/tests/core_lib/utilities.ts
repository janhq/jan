import * as path from "path";

export default class Utilities {
  fromRoot(relativePath: string): string {
    return path.resolve(process.cwd(), relativePath);
  }
}
