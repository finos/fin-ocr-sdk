/**
 * Copyright (c) 2024 Capital One
*/
export enum FSFileType {
    FILE = "file",
    DIR  = "dir",
};

export type FSFileValue = string;

export type FSDirValue = {[name: string]: FSFileInfo};

export interface FSFileInfo {
    type: FSFileType;
    value: FSFileValue | FSDirValue;
}

export interface OSFileSystem {
    isDir: (dirName: string) => boolean;
    isFile: (dirName: string) => boolean;
    readDir: (dirName: string) => string[];
    readFile: (fileName: string) => Buffer;
    writeFile: (fileName: string, buf: Buffer) => void;
    appendFile: (fileName: string, buf: Buffer) => void;
    pathJoin: (...eles: string[]) => string;
}
