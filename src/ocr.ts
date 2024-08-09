/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { Config, ConfigOpts } from "./config.js";
import { Context } from "./context.js";
import { Image, ImageFormat } from "./image.js";
import { OCV } from "./ocv.js";
import { FSMgr, FSFile } from "./fsMgr.js";
import { Translators, TranslatorsInitArgs } from "./translators.js";
import { Log } from "./log.js";
import { OCRVideoSource, OCRVideoCapture, OCRVideoCaptureCallback } from "./videoCapture.js";
import { Util } from "./util.js";

export interface Platform {
    base64: {
        encode: (buf: ArrayBuffer) => string;
        decode: (str: string) => ArrayBuffer;
    };
}

export interface OCRInitArgs {
    platform?: Platform;
    translators: TranslatorsInitArgs;
    config?: ConfigOpts;
}

export interface NewImageOpts {
    name?: string;
    format?: ImageFormat;
}

const defaultPlatform: Platform = {
    base64: {
       encode: Util.bufferToBase64,
       decode: Util.base64ToBuffer,
    }
};

/**
 * OCR (Optical Character Recognition) object
 */
export class OCR {

    public static async new(args: OCRInitArgs): Promise<OCR> {
        const root = await FSMgr.load();
        const ocv = await OCV.getInstance();
        const ocr = new OCR(root,ocv,args.platform);
        if (args.config && args.config.logLevel) {
            const levelName = args.config.logLevel;
            if (!Log.setLogLevel(levelName)) throw new Error(`Invalid log level name: '${levelName}'`);
            if (!ocr.ctx.setLogLevel(levelName)) throw new Error(`'${levelName}' is an invalid log level name`);
        }
        await ocr.init(args);
        await ocr.start();
        return ocr;
    }

    public readonly platform: Platform;
    public readonly root: FSFile;
    public readonly opencv: OCV;
    public readonly translators: Translators;
    public readonly cfg: Config;
    public readonly ctx: Context;

    private constructor(root: FSFile, opencv: OCV, platform?: Platform) {
        this.platform = platform || defaultPlatform;
        this.root = root;
        this.opencv = opencv;
        this.cfg = new Config();
        this.ctx = this.newContext("ocr-sdk");
        this.translators = new Translators(this);
    }

    private async init(args: OCRInitArgs) {
        this.ctx.debug(`Initializing OCR`);
        if (args.config) this.cfg.merge(args.config);
        await this.translators.init(args.translators, this.ctx);
        this.ctx.debug(`Initialized OCR`);
    }

    public async start() {
        this.ctx.debug(`Starting OCR`);
        await this.translators.start(this.ctx);
        this.ctx.debug(`Started OCR`);
    }

    public async stop() {
        this.ctx.debug(`Stopping OCR`);
        await this.translators.stop(this.ctx);
        this.ctx.release();
        this.ctx.debug(`Stopped OCR`);
    }

    public newContext(id: string): Context {
        return Context.obtain(id, this.cfg);
    }

    public newImage(buf: ArrayBuffer, ctx: Context, opts?: NewImageOpts): Image {
        return Image.fromBuffer(buf, this, ctx, opts);
    }

    public newVideoCapture(height: number, width: number, cb: OCRVideoCaptureCallback, opts?: {videoSource?: OCRVideoSource }): OCRVideoCapture {
        return new OCRVideoCapture(height, width, cb, this, opts);
    }

}
