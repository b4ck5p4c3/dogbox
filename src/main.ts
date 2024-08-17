import express, {RequestHandler} from "express";
import {getLogger} from "./logger";
import nodePath from "path";
import dotenv from "dotenv";
import {getRandomDirectory} from "./storage";
import {promises as fsPromises} from "fs";
import fs from "fs";
import ipaddr from "ipaddr.js";
import {AccessConfig, Accounts, parseAccessConfig, ParsedNetworkAccessConfig} from "./access-config";
import argon2 from "argon2";

dotenv.config({
    path: ".env.development"
});
dotenv.config();

const logger = getLogger();

const PORT = parseInt(process.env.PORT ?? "3000");
const STORAGE_PATH = process.env.STORAGE_PATH ?? "/storage";
const RETENTION_TIME = parseInt(process.env.RETENTION_TIME ?? "60000");
const ACCESS_CONFIG_PATH = process.env.ACCESS_CONFIG_PATH ?? "/access-config.json";

let accessConfig: AccessConfig = {
    noAuthDownloadNetworks: {
        blacklist: ["0.0.0.0/0"]
    },
    noAuthUploadNetworks: {
        blacklist: ["0.0.0.0/0"]
    },
    accounts: {}
};

try {
    accessConfig = JSON.parse(fs.readFileSync(ACCESS_CONFIG_PATH).toString("utf8"));
    logger.info(`Loaded access config from: ${ACCESS_CONFIG_PATH}`);
} catch (e) {
    throw new Error(`Failed to parse access config: ${e}`);
}

const parsedAccessConfig = parseAccessConfig(accessConfig);

const filesUrlPrefix = "/files";

const app = express();

const indexTemplate = fs.readFileSync(nodePath.join(process.cwd(), "templates", "index.html")).toString("utf-8")

function isIpAllowed(ip: string, config: ParsedNetworkAccessConfig): boolean {
    if (!ipaddr.isValid(ip)) {
        return false;
    }
    const parsedIp = ipaddr.process(ip);

    if (config.blacklist) {
        if (ipaddr.subnetMatch(parsedIp, {
            "match": config.blacklist
        }, "no-match") === "match") {
            return false;
        }
    }
    if (config.whitelist) {
        return ipaddr.subnetMatch(parsedIp, {
            "match": config.whitelist
        }, "no-match") === "match";

    }
    return true;
}

function parseAuthorizationHeader(header?: string): [string, string] | undefined {
    if (!header) {
        return undefined;
    }

    const parts = header.split(" ").map(item => item.trim()).filter(item => item);
    if (parts.length !== 2) {
        return undefined;
    }

    if (parts[0] !== "Basic") {
        return undefined;
    }

    let credentials: string;

    try {
        credentials = Buffer.from(parts[1], "base64").toString("utf8");
    } catch (e) {
        return undefined;
    }

    const decodedCredentials = credentials.split(":");
    if (decodedCredentials.length !== 2) {
        return;
    }

    return [decodedCredentials[0], decodedCredentials[1]];
}

interface AccessCheckerConfig {
    ipHeader?: string;
    fallbackToRealIp: boolean;
    accounts: Accounts;
    networkAccessConfig: ParsedNetworkAccessConfig;
}

function accessChecker(config: AccessCheckerConfig): RequestHandler {
    return (req, res, next) => {
        const ip = config.ipHeader ? (req.header(config.ipHeader) ??
            (config.fallbackToRealIp ? req.ip : undefined)) : req.ip;

        if (!ip) {
            res.status(401).end();
            return;
        }

        if (isIpAllowed(ip, config.networkAccessConfig)) {
            next();
            return;
        }

        const authorizationHeader = req.header("authorization");

        const parsedAuthData = parseAuthorizationHeader(authorizationHeader);

        if (!parsedAuthData) {
            res.status(401).header("www-authenticate", 'Basic realm="DogBox"').end();
            return;
        }

        const [user, password] = parsedAuthData;
        const passwordHash = config.accounts[user];
        if (!passwordHash) {
            res.status(401).header("www-authenticate", 'Basic realm="DogBox"').end();
            return;
        }

        argon2.verify(passwordHash, password)
            .then(match => {
                if (!match) {
                    res.status(401).header("www-authenticate", 'Basic realm="DogBox"').end();
                    return;
                }

                next();
            })
            .catch(e => {
                logger.error(`Failed to verify password: ${e}`);
                res.status(500).end();
            });
    };
}

app.use(filesUrlPrefix, accessChecker({
    ...parsedAccessConfig,
    networkAccessConfig: parsedAccessConfig.noAuthDownloadNetworks
}));

app.use(filesUrlPrefix, express.static(nodePath.join(STORAGE_PATH), {
    cacheControl: false,
    dotfiles: "allow",
    etag: false,
    index: false,
    lastModified: false,
    redirect: false,
    setHeaders: (req, path) => {
        req.setHeader("Content-Type", "application/octet-stream");
        req.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${
            encodeURIComponent(nodePath.basename(path))}`);
    }
}));

app.use(filesUrlPrefix, accessChecker({
    ...parsedAccessConfig,
    networkAccessConfig: parsedAccessConfig.noAuthUploadNetworks
}));

app.get("/", (req, res) => {
    const url = new URL(`${req.protocol}://${req.get('host')}/`);
    res.header("Content-Type", "text/html; charset=utf-8").end(indexTemplate
        .replace("{{base-url}}", url.toString())
        .replace("{{retention-time}}", Math.floor(RETENTION_TIME / 1000).toString()));
});

app.use(express.static(nodePath.join(process.cwd(), "static")));

app.use(((req, res, next) => {
    if (req.method !== "PUT") {
        next();
        return;
    }

    (async () => {
        const directory = await getRandomDirectory(STORAGE_PATH);
        const fileName = nodePath.basename(decodeURIComponent(req.path));
        const fullPath = nodePath.join(directory, fileName);
        await fsPromises.mkdir(directory);
        const fileStream = fs.createWriteStream(fullPath);
        req.pipe(fileStream);
        req.on("end", () => {
            logger.info(`Uploaded file ${fileName} to ${directory}`);
            const url = new URL(`${req.protocol}://${req.get('host')}`);
            url.pathname = `${filesUrlPrefix}/${nodePath.relative(STORAGE_PATH, fullPath)
                .replace(nodePath.sep, "/")}`;
            res.end(url.toString() + "\n");
        });
        req.on("error", () => {
            logger.warn(`Failed to upload file ${fileName} to ${directory}`);
            fileStream.close();
            fsPromises.rm(fullPath)
                .then(() => {
                    res.status(400).end();
                }).catch(error => next(error));
        });
    })().catch(error => next(error));
}));

app.listen(PORT, () => {
    logger.info(`Server started on port ${PORT}`);
});

async function cleanOldFiles() {
    logger.info(`Cleaning old files...`);
    const directories = await fsPromises.readdir(STORAGE_PATH);
    for (const directory of directories) {
        const directoryPath = nodePath.join(STORAGE_PATH, directory);
        const stats = await fsPromises.stat(directoryPath);
        if (!stats.isDirectory()) {
            continue;
        }

        if ((new Date().getTime() - stats.ctime.getTime()) < RETENTION_TIME) {
            continue;
        }

        await fsPromises.rm(directoryPath, {
            recursive: true
        });

        logger.info(`Removed ${directoryPath}`);
    }
    logger.info(`Cleaning done`);
}

function runCleaning() {
    cleanOldFiles()
        .catch(e => {
            logger.error(e);
        })
        .finally(() => {
            setTimeout(cleanOldFiles, RETENTION_TIME / 2);
        });
}

runCleaning();