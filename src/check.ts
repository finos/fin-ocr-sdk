/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { OCR } from "./ocr.js";
import { CheckUtil } from "./checkUtil.js";
import { Config } from "./config.js";
import { Contour } from "./contour.js";
import { Context } from "./context.js";
import { Image, ImageInput, NamedImageInfo, CropArgs, GetContoursOpts } from "./image.js";
import { ImageFormat } from "./image.js";
import { Line } from "./line.js";
import { TranslatorsResult, TranslatorResult } from "./translators.js";
import { cv } from "./ocv.js";
import { Util } from "./util.js";

export interface CheckPreprocessRequest {
    id: string;
    image: ImageInput;
    crop?: CropArgs;
    debug?: string[];
    logLevel?: string;
}

export interface CheckPreprocessResponse {
    id: string;
    images?: NamedImageInfo[];
    overlap?: boolean;
}

export interface CheckScanRequest extends CheckPreprocessRequest {
    translators?: string[];
    correct?: boolean;
    actual?: string;
}

export type CheckScanTranslatorsResponse = { [name: string]: CheckScanTranslatorResponse };

export interface CheckInfo {
    routingNumber: string;
    accountNumber: string;
    checkNumber: string;
    micrLine: string;
}

export interface CheckScanTranslatorResponse {
    result: CheckInfo;
    details?: TranslatorResult;
}

export interface CheckScanResponse extends CheckPreprocessResponse {
    translators: CheckScanTranslatorsResponse;
    match?: boolean;
}

interface MicrLineInfo {
    line: Line;
    bestContour: Contour;
}

/**
 * Check
 */
export class Check {

    public id: string;
    public readonly ocr: OCR;
    public readonly cfg: Config;
    public readonly name: string;
    public readonly ctx: Context;
    public overlap = false;
    private fullImage: Image | undefined;

    public constructor(id: string, ocr: OCR, opts?: { ctx?: Context }) {
        opts = opts || {};
        this.id = id;
        this.ocr = ocr;
        this.cfg = ocr.cfg;
        this.name = `check-${id}`;
        this.ctx = opts.ctx || ocr.newContext(id);
    }

    /**
     * Scan a check image and return the scan results.
     * @param img The image to scan
     * @param opts Options controlling how it is scanned
     * @returns The scan results.
     */
    public async scan(req: CheckScanRequest): Promise<CheckScanResponse> {
        const ctx = this.ctx;
        ctx.debugImages = Util.debug(req, "images");
        if (req.logLevel) ctx.setLogLevel(req.logLevel);
        const base64Encode = typeof req.image.buffer === "string";
        if (ctx.isDebugEnabled()) ctx.debug(`Begin scanning check ${this.id}: ${req.id}`);
        // Get the MICR line
        const micrLine = await this.getMicrLine(req);
        let result: TranslatorsResult = {};
        if (micrLine) {
            if (ctx.isDebugEnabled()) ctx.debug(`Found the MICR line for check ${this.id}: ${req.id}`);
            result = await this.ocr.translators.translate(micrLine, { correct: req.correct, actual: req.actual, debug: req.debug });
            if (ctx.isDebugEnabled()) ctx.debug(`Finished translating the MICR line for check ${this.id}`);
        }
        // Parse the MICR text and return the full check scan results
        const rtn = this.getCheckScanResults(req, result, ctx);
        if (ctx.isDebugEnabled()) ctx.debug(`Got check scan results for check ${this.id}`);
        // If the check number was found on the MICR line, then search elsewhere
        await this.searchForCheckNumberIfNotFoundOnMicrLine(req, rtn);
        if (!ctx.images.isEmpty()) {
            if (ctx.isDebugEnabled()) ctx.debug(`Serializing images`);
            rtn.images = await ctx.images.serialize(ImageFormat.JPG, base64Encode);
        }
        rtn.overlap = this.overlap;
        if (ctx.isDebugEnabled()) ctx.debug(`Done scanning check ${this.id}`);
        return rtn;
    }

    public async preprocess(req: CheckPreprocessRequest): Promise<CheckPreprocessResponse> {
        const ctx = this.ctx;
        ctx.debugImages = Util.debug(req, "images");
        if (req.logLevel) ctx.setLogLevel(req.logLevel);
        const base64Encode = typeof req.image.buffer === "string";
        // Get the MICR line
        const line = await this.getMicrLine(req);
        // Get result fields
        const overlap = line ? line.overlap : false;
        const images = await ctx.images.serialize(ImageFormat.JPG, base64Encode);
        return { id: req.id, images, overlap };
    }

    private async searchForCheckNumberIfNotFoundOnMicrLine(req: CheckScanRequest, rtn: CheckScanResponse) {
        const ctx = this.ctx;
        const dbg = ctx.isDebugEnabled();
        let resultContainers: CheckInfo[] = [];
        for (const translatorName in rtn.translators) {
            const tran = rtn.translators[translatorName] as CheckScanTranslatorResponse;
            const checkNum = tran.result.checkNumber;
            if (checkNum) {
                if (dbg) ctx.debug(`Check number ${checkNum} was found by translator ${translatorName}`);
                return;
            }
            resultContainers.push(tran.result);
        }
        //if (dbg) ctx.debug(`Check number was not found on image`);
        ctx.info(`Check number was not found on image`);
        if (resultContainers.length == 0) {
            if (dbg) ctx.debug(`Can't search the full image for the check number because no result containers were found`);
            return;
        }
        const tesseract = this.ocr.translators.tesseractFullPage;
        if (!tesseract) {
            if (dbg) ctx.debug(`Can't search the full image for the check number because the tesseract full page translator was not enabled`);
            return;
        }
        let fullImage = this.fullImage;
        if (!fullImage) {
            if (dbg) ctx.debug(`Can't search the full image for the check number because the full image was not found`);
            return;
        }
        // None of the translators found a check number, so look elsewhere
        //fullImage = fullImage.bitwiseNot({name: "tesseract-full-image-input"});
        fullImage.display();
        if (dbg) ctx.debug(`Call tesseract to translate the full image`);
        // Call tesseract on the full image
        const result = await tesseract.translateImage(fullImage);
        const lines = result.value.split("\n");
        const lineIdx = Util.getIndexOfFirstContaining(lines, "Check No");
        if (ctx.isDebugEnabled()) ctx.debug(`NumLines: ${lines.length}, LineIdx=${lineIdx}`);
        if (lineIdx >= 0 && lineIdx + 1 < lines.length) {
            const parts = (lines[lineIdx + 1] as string).split(" ");
            const checkNum = this.getCheckNumFromParts(parts);
            if (dbg) ctx.debug(`Check number from full page translation: ${checkNum}`);
            if (checkNum) {
                for (const result of resultContainers) {
                    result.checkNumber = checkNum;
                }
            }
        }
    }

    private getCheckNumFromParts(parts: string[]): string | undefined {
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`NumParts: ${parts.length}`);
        if (parts.length > 2 && Util.isNumeric(parts[2] as string)) {
            return parts[2];
        }
        if (parts.length > 1) {
            return parts[1];
        }
        return undefined;
    }

    /**
     * Get the MICR line
     */
    private async getMicrLine(req: CheckPreprocessRequest): Promise<Line | undefined> {
        const ctx = this.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`Getting MICR line for check ${this.id}`);
        // Convert buffer to an Image
        let buf = req.image.buffer;
        if (typeof buf === "string") buf = this.ocr.platform.base64.decode(buf);
        const format = Image.strToImageFormat(req.image.format);
        let img = Image.fromBuffer(buf, this.ocr, ctx, { format });
        if (ctx.debugImages) img.display();
        // Get gray scale to make operations more efficient
        img = img.grayScale({ name: "gray" });
        this.fullImage = img;
        // Deskew the image
        img = img.deskew();
        if (ctx.debugImages) img.display();
        // Clean the image
        // NOTE: We dilate/erode rather than erode/dilate b/c the image is white-on-black, not black-on-white yet
        const isWhiteBackground = this.isWhiteBackground(img);
        // Clean the image based on background color
        const cleanOpts = { width: 2, height: 2 };
        if (isWhiteBackground) {
            img = img.erode(cleanOpts);
            img = img.dilate(cleanOpts);
        } else {
            img = img.dilate(cleanOpts);
            img = img.erode(cleanOpts);
        }
        if (ctx.debugImages) img.display("clean");
        // By default, crop the bottom of the image since the MICR line is there.
        const cropArgs = req.crop || { begin: { height: 0.60 } };
        img = img.crop(cropArgs);
        if (ctx.debugImages) img.display();
        // Find the MICR line
        let line = this.findMicrLine(img);
        if (line) {
            this.overlap = line.overlap;
            if (ctx.debugImages) {
                const img = line.image;
                const rect = line.getBoundingRect();
                img.drawContours({ name: "micr-line-contours", contours: line.contours });
                line.display({ name: "micr-line-chars" });
                img.drawBox("micr-line", rect);
            }
            if (ctx.isDebugEnabled()) ctx.debug(`Got MICR line for check ${this.id}, overlap=${this.overlap}`);
            if (ctx.debugImages || Util.debug(req, "MICR")) {
                ctx.addImage(line.toImage({ name: "MICR" }));
            }
            return line;
        }
        if (ctx.isDebugEnabled()) ctx.debug(`Could not find the MICR line for check ${this.id}`);
        return undefined;
    }

    private isWhiteBackground(img: Image): boolean {
        const grayImg = img.grayScale();
        const totalPixels = grayImg.width * grayImg.height;
        const sampleRate = 10; //

        let pixelSum = 0;
        let sampledPixels = 0;

        for (let y = 0; y < grayImg.height; y += sampleRate) {
            for (let x = 0; x < grayImg.width; x += sampleRate) {
                pixelSum += grayImg.getPixelVal(x, y);
                sampledPixels++;
            }
        }

        const avgPixelValue = pixelSum / sampledPixels;

        return avgPixelValue > 128;
    }

    private findMicrLine(img: Image, opts?: { stopScore?: number }): Line | undefined {
        const ctx = this.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`findMicrLine: begin`);
        opts = opts || {};
        // Guassian blur
        img = img.gaussianBlur({ name: "micr-blur", dimension: 3 });
        // Use adaptive threshold based on gaussian distribution to switch from black-on-white to white-on-black
        img = img.adaptiveThreshold(cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, { name: "micr-thresh", blockSize: 19, C: 1 });
        // Get the line info
        let li = this.findMicrLineInfo(img, 1, {
            getContoursOpts: {
                minArea: this.cfg.minContourArea,
                minHeight: this.cfg.minContourHeight,
                minWidth: this.cfg.minContourWidth,
                maxWidth: img.width * 0.9,
            },
            stopScore: opts.stopScore,
        });
        if (!li) {
            if (ctx.isDebugEnabled()) ctx.debug(`findMicrLine: exit (not found 1)`);
            return undefined;
        }
        // Optionally perform overlap correction
        if (li.line.overlap && this.ocr.cfg.overlapCorrection) {
            ctx.debug(`performing overlap correction`);
            li.line.performOverlapCorrection();
            li = this.findMicrLineInfo(li.line.image, 2, opts);
            if (!li) {
                if (ctx.isDebugEnabled()) ctx.debug(`findMicrLine: exit (not found 2)`);
                return undefined;
            }
        }
        if (ctx.isDebugEnabled()) ctx.debug(`findMicrLine: exit`);
        return li.line;
    }

    private findMicrLineInfo(img: Image, count: number, opts?: { getContoursOpts?: GetContoursOpts, stopScore?: number }): MicrLineInfo | undefined {
        const ctx = this.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`findMicrLineInfo ${count}: begin`);
        opts = opts || {};
        const stopScore = opts.stopScore || 90;
        let bestScore = 0;
        let bestContour: Contour | undefined;
        // Get contours from the image, filtering out those we want to ignore
        const contours = img.getContours(opts.getContoursOpts);
        if (ctx.debugImages) img.drawContours({ name: `image-contours-${count}`, contours });
        // Sort contours bottom to top
        contours.sort((a, b) => b.rect.y - a.rect.y);
        // Find the contour that most closely matches a zero
        const translator = this.ocr.translators.opencv
        const zero = translator.getMatchEle("0");
        if (!zero) throw new Error(`Could not find a zero match element ${count}`);
        for (const contour of contours) {
            const score = translator.getMatchScore(contour.toImage(), zero);
            if (score > bestScore) {
                bestScore = score;
                bestContour = contour;
                if (ctx.isDebugEnabled()) ctx.debug(`best zero ${count}: score=${score}, contourIdx=${contour.idx}, rect=${JSON.stringify(contour.rect)}`);
                if (bestScore >= stopScore) break;
            }
        }
        if (!bestContour) {
            ctx.error(`findMicrLineInfo ${count}: exit (could not find a zero in the MICR line)`);
            return undefined;
        }
        if (ctx.debugImages) img.drawBox(`best-zero-${count}`, bestContour.rect);
        // Create a line based on the best contour
        const minCharArea = bestContour.area * 0.47;
        const maxCharArea = bestContour.area * 1.25;
        const minCharHeight = bestContour.height * 0.9;
        const line = new Line(count, img, bestContour, contours, { minCharArea, maxCharArea, minCharHeight });
        if (!line.isInitialized()) {
            ctx.error(`findMicrLineInfo ${count}: exit (line not initialized)`);
            return undefined;
        }
        // Draw the MICR line with characters
        if (ctx.debugImages) line.display();
        if (ctx.isDebugEnabled()) ctx.debug(`findMicrLineInfo: exit`);
        return { line, bestContour };
    }

    public clear() {
        this.ctx.release();
    }

    private getCheckScanResults(req: CheckScanRequest, results: TranslatorsResult, ctx: Context): CheckScanResponse {
        const translators: CheckScanTranslatorsResponse = {};
        for (const name in results) {
            translators[name] = this.getCheckScanTranslatorResult(name, req, results[name] as TranslatorResult, ctx);
        }
        return { id: req.id, translators };
    }

    private getCheckScanTranslatorResult(name: string, req: CheckScanRequest, r: TranslatorResult, ctx: Context): CheckScanTranslatorResponse {
        const result = CheckUtil.micrToCheckInfo(name, ctx, r.value);
        const resp: CheckScanTranslatorResponse = { result };
        if (Util.debug(req, "all-details")) resp.details = r;
        return resp;
    }

    // Only needed if the translator uses ABCD rather than TUAD for the special symbols
    public static normalizeSpecialSymbols(text: string): string {
        text = text.replace(/A/g, "T");
        text = text.replace(/B/g, "A");
        text = text.replace(/C/g, "U");
        return text;
    }

}
