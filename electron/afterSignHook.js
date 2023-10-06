require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { notarize } = require("@electron/notarize");

module.exports = async function (params) {
  if (process.platform !== "darwin") {
    return;
  }

  console.log("afterSign hook triggered", params);

  let appId = "jan.ai.app";

  let appPath = path.join(
    params.appOutDir,
    `${params.packager.appInfo.productFilename}.app`
  );
  if (!fs.existsSync(appPath)) {
    console.log("skip");
    return;
  }

  console.log(`Notarizing ${appId} found at ${appPath}`);

  try {
    await notarize({
      tool: "notarytool",
      appBundleId: appId,
      appPath: appPath,
      appleApiKey: process.env.APPLE_API_KEY,
      appleApiKeyId: process.env.APPLE_KEY_ID,
      appleApiIssuer: process.env.API_ISSUER
    });
  } catch (error) {
    console.error(error);
  }

  console.log(`Done notarizing ${appId}`);
};
