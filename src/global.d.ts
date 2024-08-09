/**
 * Copyright (c) 2024 Discover Financial Services
*/
export {};

declare global {
    interface Window {
        Jimp: typeof import('jimp');
    }
}
