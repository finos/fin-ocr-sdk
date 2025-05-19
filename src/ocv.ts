/**
 * Copyright (c) 2024 Capital One
*/
/*
 * Wrapper OpenCV and provide an isReady function.
 */
import cv from '@techstark/opencv-js';
export {cv};

export class OCV {

    private static instance = new OCV();

    public static async init() {
        await isReady();
    }

    public static async getInstance(): Promise<OCV> {
        await OCV.init();
        return this.instance;
    }

    private constructor() {}

}

let ready: boolean = false;

export async function isReady() {
    if (ready) return true;
    await new Promise<void>(resolve => {
        cv.onRuntimeInitialized = () => {
            ready = true;
            resolve();
        }
    });
    return {cv:cv};
}
