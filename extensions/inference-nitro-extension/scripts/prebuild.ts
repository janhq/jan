import path from "node:path";
import { downloadNitro } from "@janhq/nitro-node/scripts";

const NITRO_VERSION = process.env.NITRO_VERSION || "latest";
const BIN_PATH = path.join(__dirname, "..", "bin");

// Only run this script if called directly
if (require.main === module) {
  // Download nitro into bin directory at the root of this extension
  downloadNitro(BIN_PATH, NITRO_VERSION);
}
