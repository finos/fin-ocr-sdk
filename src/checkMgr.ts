/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { OCR, Platform } from "./ocr.js";
import { Check, CheckScanRequest, CheckScanResponse, CheckPreprocessRequest, CheckPreprocessResponse } from "./check.js"; 
import { Config, ConfigOpts } from "./config.js"; 
import { ImageFormat } from "./image.js";
import { Context } from "./context.js";

export interface CheckMgrOpts {
    platform?: Platform;
    config?: ConfigOpts;
}

/**
 * Check manager
 */
export class CheckMgr {

    private static instance: CheckMgr | undefined;

    public static async setInstanceByEnv(platform: Platform, env: {[name: string]: (string|undefined)}): Promise<CheckMgr> {
        if (this.instance) throw new Error(`CheckMgr.instance is already set`);
        this.instance = await CheckMgr.new({platform, config: Config.fromEnv(env)});
        return this.instance;
    }

    public static async getInstanceByEnv(env: {[name: string]: (string|undefined)}, opts?: { platform?: Platform}): Promise<CheckMgr> {
        opts = opts || {};
        if (this.instance) return this.instance;
        this.instance = await CheckMgr.new({platform: opts.platform, config: Config.fromEnv(env)});
        return this.instance;
    }

    public static async setInstance(opts?: CheckMgrOpts): Promise<CheckMgr> {
        if (this.instance) throw new Error(`CheckMgr.instance is already set`);
        this.instance = await CheckMgr.new(opts);
        return this.instance;
 
    }

    public static async getInstance(): Promise<CheckMgr> {
        if (!this.instance) throw new Error(`CheckMgr.instance has not been set`);
        return this.instance;
    }

    public static async new(opts?: CheckMgrOpts): Promise<CheckMgr> {
        opts = opts || {};
        const ocr = await OCR.new({
            platform: opts.platform,
            translators: {
                opencv: {
                    refImage: "micr_ref.tif",
                    format: ImageFormat.TIF,
                    charDescriptors: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "T:3", "U:3", "A:3", "D:3"],
                    correctionsDir: "corrections",
                },
                tesseract: {
                    font: "micr_e13b",
                    pageSegmentationMode: "13",
                }
            },
            config: opts.config,
        });
        return new CheckMgr(ocr);
    }

    public readonly ocr: OCR; 

    private constructor(ocr: OCR) {
        this.ocr = ocr;
    }

    public newCheck(id: string, opts?: {ctx?: Context}): Check {
        return new Check(id, this.ocr, opts);
    }

    public newContext(id: string): Context {
        return Context.obtain(id);
    }

    public async scan(req: CheckScanRequest, opts?: {ctx?: Context, logLevel?: string}): Promise<CheckScanResponse> {
        const check = this.newCheck(req.id, opts);
        const resp = await check.scan(req);
        check.clear();
        return resp;
    }

    public async preprocess(req: CheckPreprocessRequest, opts?: {ctx?: Context, logLevel?: string}): Promise<CheckPreprocessResponse> {
        const check = this.newCheck(req.id, opts);
        const resp = await check.preprocess(req);
        check.clear();
        return resp;
    }

    public async stop() {
        await this.ocr.stop();
    }
}
