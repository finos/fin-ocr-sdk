/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { OCR, OCRInitArgs, NewImageOpts } from "./ocr.js";
import { Image } from "./image.js";
import { Context } from "./context.js";

export class Scanner {

    public static async new(info: ScannerInfo): Promise<Scanner> {
        const ocr = await OCR.new(info.settings);
        return new Scanner(ocr, info);
    }

    public static ACTION_GRAY = "gray";
    public static ACTION_DESKEW = "deskew";

    public ocr: OCR;
    public info: ScannerInfo;

    constructor(ocr: OCR, info: ScannerInfo) {
        this.ocr = ocr;
        this.info = info;
        this.validate(info);
    }

    private validate(info: ScannerInfo) {
        for (let i = 0; i < info.actions.length; i++) {
            const action = info.actions[i] as ScannerAction;
            const type = action.type.toLowerCase();
            const desc = actionDescriptors[type];
            if (!desc) throw new Error(`'${type}' is not a valid action type in action ${i+1}; expecting one of ${JSON.stringify(actionTypes)}`)
            for (const key of Object.keys(action)) {
                if ((!desc.required || desc.required.indexOf(key) < 0) && (!desc.optional || desc.optional.indexOf(key) < 0)) {
                    throw new Error(`'${key}' is an unknown property for action ${i+1}`);
                }
            }
            if (desc.required) {
                for (const key of desc.required) {
                    if (!(key in action)) {
                        throw new Error(`action ${i+1} is missing property '${key}' which is required for action type '${type}'`);
                    }
                }
            }
        }
    }

    public async scan(buf: ArrayBuffer, ctx: Context, opts?: NewImageOpts): Promise<any> {
        const img = this.ocr.newImage(buf, ctx, opts);
        const sctx: ScannerContext = { scanner: this, img};
        try {
            for (let i = 0; i < this.info.actions.length; i++) {
                const action = this.info.actions[i] as ScannerAction;
                const type = action.type.toLowerCase();
                const desc = actionDescriptors[type] as ActionDescriptor;
                if (!desc) throw new Error(`'${type}' is not a valid action type in action ${i+1}; expecting one of ${JSON.stringify(actionTypes)}`);
                desc.fcn(sctx);
            }
        } finally {
            img.ctx.release();
        }
    }

}

interface ScannerContext {
    scanner: Scanner;
    img: Image;
}

export interface ScannerSettings extends OCRInitArgs {
}

export interface ScannerInfo {
    name: string;
    settings: ScannerSettings;
    actions: ScannerAction[];
}

export type ScannerAction = ScannerActionGray;

export interface ScannerActionGray extends ScannerActionBase {
    name?: string;
}

export interface ScannerActionBase {
    type: string;
}

interface ActionDescriptor {
    required?: string[];
    optional?: string[];
    fcn: (ctx: ScannerContext) => void;
}

const actionDescriptors: {[name: string]: ActionDescriptor} = {
    gray: {
        optional: ["name"],
        fcn: (ctx: ScannerContext) => {
            ctx.img = ctx.img.grayScale();
        }
    },
    deskew: {
        optional: ["name"],
        fcn: (ctx: ScannerContext) => {
            ctx.img = ctx.img.deskew();
        }
    }
};

const actionTypes = Object.keys(actionDescriptors);
