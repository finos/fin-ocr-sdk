/**
 * Copyright (c) 2024 Discover Financial Services
*/
import {cv} from './ocv.js';
import {Color} from './color.js';
import {Context} from './context.js';
import {Line} from './line.js';
import {OCR} from './ocr.js';
import {TesseractTranslator, TesseractTranslatorInitArgs} from './tesseractTranslator.js';
import {OpencvTranslator, OpencvTranslatorInitArgs} from './opencvTranslator.js';
import {Image} from './image.js';
import {Util} from './util.js';

export interface TranslatorsInitArgs {
    opencv: OpencvTranslatorInitArgs;
    tesseract?: TesseractTranslatorInitArgs;
}

export interface TranslatorOpts {
    actual?: string;
    correct?: boolean;
    debug?: string[];
}

export interface TranslatorChoice {
    value: string;
    score: number;
}

export interface TranslatorResult {
    value: string;
    score: number;
    chars: TranslatorChar[];
}

export interface Translator {
    name: string;
    translate(line: Line, opts?: TranslatorOpts): Promise<TranslatorResult>
}

export type TranslatorsResult = {[name: string]: TranslatorResult};
    
/**
 * Translators contains one or more translators in general.
 * By default, tessaract and opencv are configured as translators.
 * Each translator can have start/stop lifecycle.
 */
export class Translators {

    private readonly translators: Translator[] = [];

    public ocr: OCR;
    public opencv: OpencvTranslator;
    public tesseract?: TesseractTranslator;
    public tesseractFullPage?: TesseractTranslator;

    constructor(ocr: OCR) {
        this.ocr = ocr;
        // The opencv translator is required in the preprocessing phase for location purposes, 
        // so we always instantiate it; however, we only add it to the translators list if it
        // it is to be used in the translation phase.
        this.opencv = new OpencvTranslator(ocr);
    }

    public async init(args: TranslatorsInitArgs, ctx: Context) {
        ctx.debug(`Initializing translators`);
        await this.opencv.init(args.opencv, ctx);
        const names = this.ocr.cfg.translators.split(",");
        for (const name of names) {
            if (args.tesseract && name === "tesseract") {
                this.tesseract = new TesseractTranslator(this.ocr);
                await this.tesseract.init(args.tesseract, ctx);
                this.translators.push(this.tesseract);
                ctx.info("Added tesseract MICR translator");
                this.tesseractFullPage = new TesseractTranslator(this.ocr);
                await this.tesseractFullPage.init({ font: "eng", pageSegmentationMode: "3" }, ctx);
                ctx.info("Added tesseract full page translator");
            } else if (name === "opencv") {
                this.translators.push(this.opencv);
                ctx.info("Added opencv translator");
            } else {
                throw new Error(`Invalid translator name '${name}' found in OCR_TRANSLATORS environment variable; valid values are 'tesseract' and 'opencv' with a comma separator`);
            }
        }
        ctx.debug(`Initialized translators`);
    }

    public async start(ctx: Context) {
        if (this.tesseract) await this.tesseract.start(ctx);
        if (this.tesseractFullPage) await this.tesseractFullPage.start(ctx);
    }

    public async stop(ctx: Context) {
        if (this.tesseract) await this.tesseract.stop(ctx);
        if (this.tesseractFullPage) await this.tesseractFullPage.stop(ctx);
    }

    public async translate(line: Line, opts?: TranslatorOpts): Promise<TranslatorsResult> {
        opts = opts || {};
        if (opts.correct && opts.actual === undefined) throw new Error(`setting 'correct' to true also requires setting 'actual'`);
        const result: TranslatorsResult = {};
        const ctx = line.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`Begin translations`);
        for (const translator of this.translators) {
            if (ctx.isDebugEnabled()) ctx.debug(`Calling ${translator.name} translator`);
            const r = await translator.translate(line, opts);
            if (ctx.isDebugEnabled()) ctx.debug(`Called ${translator.name} translator`);
            result[translator.name] = r;
            if (Util.debug(opts, "images")) {
                this.displayTranslatorResult(`${translator.name}-translation`, r, ctx, opts.actual);
            }
        }
        if (ctx.isDebugEnabled()) ctx.debug(`Completed translations`);
        return result;
    }

    private displayTranslatorResult(name: string, result: TranslatorResult, ctx: Context, actual?: string) {
        const chars = result.chars;
        if (ctx.isDebugEnabled()) ctx.debug(`displayTranslatorResult enter: name=${name}, numChars=${chars.length}, actualLen=${actual?actual.length:"?"}`);
        if (chars.length === 0) {
            if (ctx.isDebugEnabled()) ctx.debug(`displayTranslatorResult exit - ${name} (no characters to display)`)
            return;
        }
        // Calculate the total size of the image needed
        let minCharWidth = 30;
        let widthBetweenChars = 13;
        let imgWidth = 0;
        let maxImageHeight = 0;
        let maxChoices = 0;
        for (const char of chars) {
            const img = char.image;
            if (img) {
                imgWidth += Math.max(img.width, minCharWidth) + widthBetweenChars;
                maxImageHeight = Math.max(img.height, maxImageHeight);
            } else {
                imgWidth += minCharWidth + widthBetweenChars + 10;
            }
            maxChoices = Math.max(char.choices.length, maxChoices);
        }
        const extraActual = actual ? Math.max(0, actual.length - chars.length) : 0;
        imgWidth += extraActual * (minCharWidth + widthBetweenChars);
        const imgHeight = maxImageHeight + 45 + (16 * maxChoices);
        // Create the new mat for the image
        const mat = new cv.Mat(imgHeight, imgWidth, cv.CV_8U, Color.black);
        ctx.addDeletable(mat);
        cv.cvtColor(mat, mat, cv.COLOR_GRAY2RGB);
        // Write info one character at a time
        let x = 0;
        for (let i = 0; i < chars.length; i++) {
            const char = chars[i] as TranslatorChar;
            let img = char.image;
            let colWidth = minCharWidth;
            let actualChar: string | undefined;
            // Write the char index
            let y = 15;
            this.writeText(`${i}`, Color.white, x+6, y, mat);
            // If the actual value was provided, write it
            if (actual) {
                y += 15;
                if (actual.length >= i) {
                    actualChar = actual.charAt(i);
                    this.writeText(actualChar, Color.white, x+6, y, mat);
                }
            }
            // Copy the image if the translator provides it
            if (img) {
                y += 8;
                const rect = new cv.Rect(x, y, img.width, img.height);
                let mat2 = img.mat.clone();
                ctx.addDeletable(mat2);
                cv.cvtColor(mat2, mat2, cv.COLOR_GRAY2RGB);
                mat2.copyTo(mat.roi(rect));
                colWidth = Math.max(colWidth, img.width);
                y += maxImageHeight + 15;
            }  else {
                y += 15;
                colWidth += 10;
            }
            // Write the value and score of choices
            if (char.choices.length > 0) {
                const best = char.choices.shift() as TranslatorChoice;
                const color = actualChar && actualChar !== best.value ? Color.red : Color.white;
                this.writeText(`${best.value}:${best.score}`, color, x,y,mat);
                for (const choice of char.choices) {
                    y += 15;
                    this.writeText(`${choice.value}:${choice.score}`, Color.white, x,y,mat);
                }
            }
            // Increment x for next column
            x += colWidth + widthBetweenChars;
        }
        if (actual) {
            for (let i = chars.length; i < actual.length; i++) {
                let y = 15;
                this.writeText(`${i}`, Color.white, x+6, y, mat);
                y += 15;
                this.writeText(actual.charAt(i), Color.white, x+6, y, mat);
                x += 15;
            }
        }
        const img = new Image(name, mat, this.ocr, ctx);
        img.display();
        if (ctx.isDebugEnabled()) ctx.debug(`displayTranslatorResult exit - ${name}`)
    }

    private writeText(text: string, color: cv.Scalar, x: number, y: number, mat: cv.Mat) {
        const labelPt = new cv.Point(x,y);
        cv.putText(mat, text, labelPt, cv.FONT_HERSHEY_PLAIN, 1, color, 1);
    }

}

export class TranslatorChar {

    public choices: TranslatorChoice[];
    public numContours?: number;
    public image?: Image;
    public corrected: boolean;

    constructor(choices: TranslatorChoice[], opts?: {numContours?: number, image?: Image, corrected?: boolean}) {
        this.choices = choices;
        opts = opts || {};
        this.numContours = opts.numContours;
        this.image = opts.image;
        this.corrected = opts.corrected || false;
    }

    public getBest(): TranslatorChoice {
        if (this.choices.length == 0) throw new Error(`there are no choices`);
        return this.choices[0] as TranslatorChoice;
    }

    public toJSON() {
        return { choices: this.choices }
    }
}
