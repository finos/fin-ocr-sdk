/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { cv } from "./ocv.js";
import { OCR } from "./ocr.js";
import { Context } from "./context.js";
import { Image } from "./image.js";

export type OCRVideoSource = HTMLVideoElement | string;
export type OCRVideoCaptureCallback = (image: Image) => Promise<boolean>;

export class OCRVideoCapture {

    private readonly fps = 30;
    private readonly ctx: Context;
    private readonly image: Image;
    private readonly cb: OCRVideoCaptureCallback;
    private vc?: cv.VideoCapture;
    private videoSource: OCRVideoSource;

    public constructor(height: number, width: number, cb: OCRVideoCaptureCallback, ocr: OCR, opts?: {videoSource?: OCRVideoSource}) {
        opts = opts || {};
        this.videoSource = opts.videoSource || "0";
        this.cb = cb;
        this.ctx = ocr.newContext("vc");
        const mat = new cv.Mat(height, width, cv.CV_8UC4);
        this.image = new Image("VideoCapture", mat, ocr, this.ctx);
    }

    public start() {
        this.ctx.info(`Starting video capture`)
        this.vc = new cv.VideoCapture(this.videoSource);
        this.scheduleProcess(0);
        this.ctx.info(`Started video capture`)
    }

    public stop() {
        this.ctx.info(`Stopping video capture`)
        this.vc = undefined;
    }

    private async process() {
        try {
            const vc = this.vc;
            if (!vc) {
                this.ctx.info(`Stopped video capture`)
                return;
            }
            // Read this image
            vc.read(this.image.mat);
            // Call the callback to process this image
            const ok = await this.cb(this.image);
            // Release memory
            this.ctx.release();
            // schedule the next one.
            if (ok) {
               this.scheduleProcess();
            } else {
                this.stop();
            }
        } catch (err) {
            this.ctx.error(`Error processing video capture`, err);
            this.stop();
        }
    }

    private scheduleProcess(delay?: number) {
        delay = delay === undefined ? this.fps : delay;
        setTimeout(this.process.bind(this), delay);
    }

}
