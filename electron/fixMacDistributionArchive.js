const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");
const yaml = require("js-yaml");
const { appBuilderPath } = require("app-builder-bin");

module.exports = function (params) {
  console.log("Verification if MacOS build is present.");

  let macBuild = false;

  params.platformToTargets.forEach((value, platform) => {
    if (platform.name === "mac") {
      macBuild = value.get("zip").packager;
    }
  });

  if (!macBuild) {
    console.log("No MacOS build is present in platform targets.");
    return;
  }

  console.log("Mac OS build found, creating new archive.");
  execSync(
    `ditto -c -k --sequesterRsrc --keepParent --zlibCompressionLevel 9 "${params.outDir}/mac/${macBuild.appInfo.productFilename}.app" "${params.outDir}/${macBuild.appInfo.productFilename}-${macBuild.appInfo.buildVersion}-mac.zip"`
  );

  console.log("Mac OS build archive has been created.");

  const APP_GENERATED_BINARY_PATH = path.join(
    params.outDir,
    `${macBuild.appInfo.productFilename}-${macBuild.appInfo.buildVersion}-mac.zip`
  );

  try {
    let output = execSync(
      `${appBuilderPath} blockmap --input="${APP_GENERATED_BINARY_PATH}" --output="${params.outDir}/${macBuild.appInfo.productFilename}-${macBuild.appInfo.buildVersion}-mac.zip.blockmap" --compression=gzip`
    );
    let { sha512, size } = JSON.parse(output);

    const ymlPath = path.join(params.outDir, "latest-mac.yml");
    let ymlData = yaml.safeLoad(fs.readFileSync(ymlPath, "utf8"));

    ymlData.sha512 = sha512;
    ymlData.files[0].sha512 = sha512;
    ymlData.files[0].size = size;
    let yamlStr = yaml.safeDump(ymlData);

    fs.writeFileSync(ymlPath, yamlStr, "utf8");
    console.log(
      "Successfully updated YAML file and configurations with blockmap."
    );
  } catch (e) {
    console.log(
      "Error in updating YAML file and configurations with blockmap.",
      e
    );
  }
};
