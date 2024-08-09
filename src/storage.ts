import {promises as fsPromises} from "fs";
import nodePath from "path";

const chars = "abcdefghijklmnopqrstuvwxyz0123456789";

function getRandomString(length: number = 5): string {
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export async function getRandomDirectory(basePath: string): Promise<string> {
    while (true) {
        const directoryName = getRandomString();
        const fullPath = nodePath.join(basePath, directoryName);

        try {
            await fsPromises.stat(fullPath);
        } catch (e) {
            return fullPath;
        }
    }
}