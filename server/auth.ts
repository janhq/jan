import { appPath, invokeFunction } from "./utils";
const crypto = require('crypto');
const DB_NAME = "auth";
const DB_PREF = "preferences";
const API_KEY_NAME = "JanServer.apiKey";
const API_KEY = process.env.API_KEY || "";

// Create auth db
createCollection(DB_NAME);
createCollection(DB_PREF);
if (API_KEY) {
    getApiKey().then((keyObj) => {
        if (!keyObj) {
            insertOne(DB_PREF, { _id: API_KEY_NAME, value: API_KEY });
        } else {
            if (API_KEY !== keyObj.value) {
                updateOne(DB_PREF, API_KEY_NAME, { value: API_KEY });
                deleteMany(DB_NAME, {});
            }
        }
    });
}

export async function generateToken(apiKey: string, ip: string): Promise<string> {
    const serverApiKey = await getApiKeyValue();
    if (API_KEY && serverApiKey !== apiKey) {
        return "";
    }
    const token = hash(`${apiKey}:${ip}`);
    insertOne(DB_NAME, { ip: ip, token: token, created: new Date() })
    return token;
}

export async function verifyToken(token: string): Promise<boolean> {
    if (!API_KEY) {
        return true;
    }
    const serverApiKey = await getApiKeyValue();
    if (!serverApiKey || !token) {
        return false;
    }
    const exist = await findMany(DB_NAME, { token: token });
    return exist.length >= 1;
}

function hash(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
}

async function createCollection(name: string): Promise<void> {
    invokeFunction("@janhq/data-plugin/dist/cjs/module.js", "createCollection", [name]);
}

async function insertOne(name: string, obj: any): Promise<void> {
    invokeFunction("@janhq/data-plugin/dist/cjs/module.js", "insertOne", [name, obj]);
}

async function findMany(name: string, filter: any): Promise<any> {
    return invokeFunction("@janhq/data-plugin/dist/cjs/module.js", "findMany", [name, filter]);
}

async function deleteMany(name: string, filter: any): Promise<void> {
    invokeFunction("@janhq/data-plugin/dist/cjs/module.js", "deleteMany", [name, filter]);
}

async function getApiKeyValue(): Promise<string> {
    const res = await invokeFunction("@janhq/data-plugin/dist/cjs/module.js", "findOne", [DB_PREF, API_KEY_NAME]);
    return res?.value;
}

async function getApiKey(): Promise<any> {
   return await invokeFunction("@janhq/data-plugin/dist/cjs/module.js", "findOne", [DB_PREF, API_KEY_NAME]);;
}

async function updateOne(name: string, key: string, obj: any): Promise<void> {
    invokeFunction("@janhq/data-plugin/dist/cjs/module.js", "updateOne", [name, key, obj]);
}