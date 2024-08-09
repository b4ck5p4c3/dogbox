import express from "express";
import {getLogger} from "./logger";
import nodePath from "path";
import dotenv from "dotenv";
import {getRandomDirectory} from "./storage";
import {promises as fsPromises} from "fs";
import fs from "fs";

dotenv.config({
    path: ".env.development"
});
dotenv.config();

const logger = getLogger();

const PORT = parseInt(process.env.PORT ?? "3000");
const STORAGE_PATH = process.env.STORAGE_PATH ?? "/storage";
const RETENTION_TIME = parseInt(process.env.RETENTION_TIME ?? "60000");

const filesUrlPrefix = "/files";

const app = express();

const indexTemplate = fs.readFileSync(nodePath.join(process.cwd(), "templates", "index.html")).toString("utf-8")

app.get("/", (req, res) => {
    const url = new URL(`${req.protocol}://${req.get('host')}/`);
    res.header("Content-Type", "text/html; charset=utf-8").end(indexTemplate
        .replace("{{base-url}}", url.toString())
        .replace("{{retention-time}}", Math.floor(RETENTION_TIME / 1000).toString()));
});

app.use(express.static(nodePath.join(process.cwd(), "static")));
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