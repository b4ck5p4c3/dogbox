import {IPv4, IPv6, isValidCIDR, parseCIDR} from "ipaddr.js";

export interface NetworkAccessConfig {
    whitelist?: string[];
    blacklist?: string[];
}

export type CIDR = [IPv4 | IPv6, number];

export interface ParsedNetworkAccessConfig {
    whitelist?: CIDR[],
    blacklist?: CIDR[],
}

export type Accounts = Record<string, string>;

export interface AccessConfig {
    fallbackToRealIp: boolean;
    ipHeader?: string;
    noAuthDownloadNetworks: NetworkAccessConfig;
    noAuthUploadNetworks: NetworkAccessConfig;
    accounts: Accounts;
}

export interface ParsedAccessConfig {
    fallbackToRealIp: boolean;
    ipHeader?: string;
    noAuthDownloadNetworks: ParsedNetworkAccessConfig;
    noAuthUploadNetworks: ParsedNetworkAccessConfig;
    accounts: Accounts;
}

function parseNetworkAccessList(list?: string[]): CIDR[] | undefined {
    if (!list) {
        return undefined;
    }

    const result: CIDR[] = [];
    for (const item of list) {
        if (!isValidCIDR(item)) {
            throw new Error(`Invalid CIDR: ${item}`);
        }
        result.push(parseCIDR(item));
    }
    return result;
}

function parseNetworkAccessConfig(config: NetworkAccessConfig): ParsedNetworkAccessConfig {
    return {
        whitelist: parseNetworkAccessList(config.whitelist),
        blacklist: parseNetworkAccessList(config.blacklist)
    };
}

export function parseAccessConfig(config: AccessConfig): ParsedAccessConfig {
    return {
        fallbackToRealIp: config.fallbackToRealIp,
        ipHeader: config.ipHeader,
        accounts: config.accounts,
        noAuthDownloadNetworks: parseNetworkAccessConfig(config.noAuthDownloadNetworks),
        noAuthUploadNetworks: parseNetworkAccessConfig(config.noAuthUploadNetworks),
    };
}