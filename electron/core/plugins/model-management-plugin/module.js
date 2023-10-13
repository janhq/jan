const { listModels, listFiles, fileDownloadInfo } = require("@huggingface/hub");
const https = require("https");

let modelsIterator = undefined;
let currentSearchOwner = undefined;

// Github API
const githubHostName = "api.github.com";
const githubHeaders = {
  "User-Agent": "node.js",
  Accept: "application/vnd.github.v3+json",
};
const githubPath = "/repos/janhq/models/contents";

const getNextModels = async (count) => {
  const models = [];
  let hasMore = true;

  while (models.length < count) {
    const next = await modelsIterator.next();

    // end if we reached the end
    if (next.done) {
      hasMore = false;
      break;
    }

    const model = next.value;
    const files = await listFilesByName(model.name);

    models.push({
      ...model,
      files,
    });
  }

  const result = {
    data: models,
    hasMore,
  };
  return result;
};

const searchModels = async (params) => {
  if (currentSearchOwner === params.search.owner && modelsIterator != null) {
    // paginated search
    console.debug(`Paginated search owner: ${params.search.owner}`);
    const models = await getNextModels(params.limit);
    return models;
  } else {
    // new search
    console.debug(`Init new search owner: ${params.search.owner}`);
    currentSearchOwner = params.search.owner;
    modelsIterator = listModels({
      search: params.search,
      credentials: params.credentials,
    });

    const models = await getNextModels(params.limit);
    return models;
  }
};

const listFilesByName = async (modelName) => {
  const repo = { type: "model", name: modelName };
  const fileDownloadInfoMap = {};
  for await (const file of listFiles({
    repo: repo,
  })) {
    if (file.type === "file" && file.path.endsWith(".bin")) {
      const downloadInfo = await fileDownloadInfo({
        repo: repo,
        path: file.path,
      });
      fileDownloadInfoMap[file.path] = {
        ...file,
        ...downloadInfo,
      };
    }
  }

  return fileDownloadInfoMap;
};

async function getConfiguredModels() {
  const files = await getModelFiles();

  const promises = files.map((file) => getContent(file));
  const response = await Promise.all(promises);

  const models = [];
  response.forEach((model) => {
    models.push(parseToModel(model));
  });

  return models;
}

const parseToModel = (model) => {
  const modelVersions = [];
  model.versions.forEach((v) => {
    const version = {
      id: `${model.author}-${v.name}`,
      name: v.name,
      quantMethod: v.quantMethod,
      bits: v.bits,
      size: v.size,
      maxRamRequired: v.maxRamRequired,
      usecase: v.usecase,
      downloadLink: v.downloadLink,
      productId: model.id,
    };
    modelVersions.push(version);
  });

  const product = {
    id: model.id,
    name: model.name,
    shortDescription: model.shortDescription,
    avatarUrl: model.avatarUrl,
    author: model.author,
    version: model.version,
    modelUrl: model.modelUrl,
    nsfw: model.nsfw,
    tags: model.tags,
    greeting: model.defaultGreeting,
    type: model.type,
    createdAt: model.createdAt,
    longDescription: model.longDescription,
    status: "Downloadable",
    releaseDate: 0,
    availableVersions: modelVersions,
  };
  return product;
};

async function getModelFiles() {
  const options = {
    hostname: githubHostName,
    path: githubPath,
    headers: githubHeaders,
  };

  const data = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        const files = JSON.parse(data);

        if (files.filter == null) {
          console.error(files.message);
          reject(files.message ?? "No files found");
        }
        if (!files || files.length === 0) {
          resolve([]);
        }
        const jsonFiles = files.filter((file) => file.name.endsWith(".json"));
        resolve(jsonFiles);
      });
    });

    req.on("error", (error) => {
      console.error(error);
    });

    req.end();
  });

  return data;
}

async function getContent(file) {
  const options = {
    hostname: githubHostName,
    path: `${githubPath}/${file.path}`,
    headers: githubHeaders,
  };

  const data = await new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        const fileData = JSON.parse(data);
        const fileContent = Buffer.from(fileData.content, "base64").toString();
        resolve(JSON.parse(fileContent));
      });
    });

    req.on("error", (error) => {
      console.error(error);
    });

    req.end();
  });

  return data;
}

module.exports = {
  searchModels,
  getConfiguredModels,
};
