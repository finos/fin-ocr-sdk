/**
 * Copyright (c) 2024 Capital One
*/
export {};

declare global {
    interface Window {
        Jimp: typeof import('jimp');
    }
}
