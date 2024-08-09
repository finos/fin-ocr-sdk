/**
 * Copyright (c) 2024 Discover Financial Services
*/
import {cv} from './ocv.js';
import {Char} from './char.js';
import {Contour} from './contour.js';
import {Context} from './context.js';
import {Image, ImageFormat} from './image.js';
import {Line} from './line.js';
import {OCR} from './ocr.js';
import { Translator, TranslatorResult, TranslatorChar, TranslatorChoice, TranslatorOpts } from './translators.js';
import {Util} from './util.js';

export interface OpencvTranslatorInitArgs {
    refImage: string;
    charDescriptors: string[];
    format?: ImageFormat;
    correctionsDir?: string;
}

export interface OpencvTranslatorMatch {
    value: string;
    score: number;
}

export interface OpencvTranslatorMatchEle {
    image: Image;
    value: string;
    numContours: number;
}

export type OpencvTranslatorCharReporterFcn = (img: ArrayBuffer, charNum: number, numContours: number) => Promise<void>;

export class OpencvTranslator implements Translator {

    public readonly ocr: OCR;
    public readonly name = "opencv";

    private readonly size = new cv.Size(36,36); 
    private readonly singleContourEles: OpencvTranslatorMatchEle[] = [];
    private readonly multiContourEles: OpencvTranslatorMatchEle[] = [];
    private readonly eleByValue: { [value: string]: OpencvTranslatorMatchEle } = {};

    public constructor(ocr: OCR) {
        this.ocr = ocr;
    }

    public async init(args: OpencvTranslatorInitArgs, ctx: Context) {
        if (ctx.isDebugEnabled()) ctx.debug(`Initializing opencv translator: ${JSON.stringify(args)}`);
        await this.loadReferenceImage(args, ctx);
        if (args.correctionsDir) {
            await this.loadCorrections(args.correctionsDir, ctx);
        }
        if (ctx.isDebugEnabled()) ctx.debug(`Initialized opencv translator`);
    }

    private async loadReferenceImage(args: OpencvTranslatorInitArgs, ctx: Context) {
        if (ctx.isDebugEnabled()) ctx.debug(`loadReferenceImage: args=${JSON.stringify(args)}`);
        const buf = this.ocr.root.readFile(args.refImage);
        let img = Image.fromBuffer(buf, this.ocr, ctx, {name: "learn-reference", format: args.format});
        img = img.grayScale({name: "learn-gray"});
        img = img.threshold(cv.THRESH_BINARY_INV + cv.THRESH_OTSU, {name: "learn-otsu"});
        const contours = img.getContours();
        for (let charIdx=0, contourIdx=0; charIdx < args.charDescriptors.length; charIdx++) {
            const cd = args.charDescriptors[charIdx] as string;
            const parts = cd.split(":");
            const c = parts[0] as string;
            const numContours = parts.length >= 2 ? parseInt(parts[1] as string): 1;
            const rects: cv.Rect[] = [];
            for (let j=0; j < numContours; j++, contourIdx++) {
                if (contourIdx >= contours.length) throw new Error(`Failed to get contour for index ${contourIdx} of ${cd}`);
                const contour = contours[contourIdx] as Contour;
                rects.push(contour.rect);
            }
            let mat = Util.getBoundingMat(img.mat, rects);
            let img2 = new Image(`learn-char-${charIdx}`, mat, this.ocr, img.ctx);
            img2 = img2.resize(this.size, {name: `learn-char-${charIdx}-resized`});
            this.add(img2, c, numContours, ctx);
        }
        if (ctx.isDebugEnabled()) ctx.debug(`loadReferenceImage: exit`);
    }

    private async loadCorrections(dirName: string, ctx: Context) {
        if (ctx.isDebugEnabled()) ctx.debug(`loadCorrections: enter`);
        const dir = this.ocr.root.getFile(dirName);
        const fileNames = dir.listFileNames();
        for (const tifFileName of fileNames) {
            if (!tifFileName.endsWith(".tif")) continue;
            const ctFileName = tifFileName.replace(".tif",".ct");
            if (!dir.exists(ctFileName)) {
                ctx.warn(`Found ${tifFileName} but did not find ${ctFileName}; unable to load this correction`);
                continue;
            }
            const tif = dir.readFile(tifFileName);
            const ct = dir.readString(ctFileName).split(":");
            let image = this.ocr.newImage(tif, ctx, {name: tifFileName, format: ImageFormat.TIF});
            image = image.grayScale();
            const value = ct[0] as string;
            const numContours = parseInt(ct[1] as string);
            this.add(image, value, numContours, ctx);
        }
        if (ctx.isDebugEnabled()) ctx.debug(`loadCorrections: exit`);
    }

    public learnChar(char: Char, value: string, ctx: Context) {
        const img = char.toImage().resize(this.size, {name: `learn-char-${value}`});
        this.add(img, value, char.contours.length, ctx);
    }

    public add(image: Image, value: string, numContours: number, ctx: Context) {
        const ele: OpencvTranslatorMatchEle = {image, value, numContours};
        const eles = numContours == 1 ? this.singleContourEles : this.multiContourEles;
        if (ctx.isVerboseEnabled()) ctx.verbose(`adding match element idx=${eles.length}, value=${value}, numContours=${numContours}, image=${image.name}`);
        eles.push(ele);
        this.eleByValue[value] = ele;
    }

    public getCharImage(value: string): Image | undefined {
        const ele = this.eleByValue[value];
        if (ele) return ele.image;
        return undefined;
    }

    public async translate(line: Line, opts?: TranslatorOpts): Promise<TranslatorResult> {
        const ctx = line.ctx;
        if (ctx.isVerboseEnabled()) ctx.verbose(`translate enter`)
        opts = opts || {};
        let score = 0;
        let value = "";
        const chars = line.getChars();
        let correct = opts.correct;
        const actual = opts.actual as string;
        if (correct) {
            if (!actual) throw new Error(`'correct' is set but 'actual' was not provided`);
            if (actual.length !== chars.length) {
                correct = false;
                ctx.info(`Disabling correction because the number of actual characters (${actual.length}) does not match the number of OCR'ed characters (${chars.length})`);
            }
        }
        const resultsChars: TranslatorChar[] = [];
        for (let i = 0; i < chars.length; i++) {
            const char = chars[i] as Char;
            const correctChar = correct ? actual.charAt(i) : undefined;
            const tm = this.translateChar(char,{correctChar});
            resultsChars.push(tm);
            if (tm.choices.length > 0) {
                const choice = tm.choices[0] as TranslatorChoice;
                score += choice.score;
                value += choice.value;
            }
        }
        score = Math.round(score/chars.length);
        if (ctx.isDebugEnabled()) ctx.debug(`translate exit - score=${score}, value=${value}`);
        return {
            value,
            score,
            chars: resultsChars,
        };
    }

    public translateChar(char: Char, opts?: {correctChar?: string, debugMat?: cv.Mat}): TranslatorChar {
        const ctx = char.ctx;
        opts = opts || {};
        const result = this.doTranslate(char.toImage(), char.idx, char.contours.length, opts);
        if (ctx.isDebugEnabled()) ctx.debug(`translateChar: ${JSON.stringify(result)}`);
        return result;
    }

    public translateContour(contour: Contour): TranslatorChar {
        const ctx = contour.ctx;
        const result = this.doTranslate(contour.toImage(), 0, 1);
        if (ctx.isDebugEnabled()) ctx.debug(`translateContour: ${JSON.stringify(result)}`);
        return result;
    }

    public getMatchEle(value: string): OpencvTranslatorMatchEle | undefined {
        const eles = [...this.singleContourEles, ...this.multiContourEles];
        for (const ele of eles) {
            if (ele.value == value) return ele;
        }
        return undefined;
    }

    public getMatchScore(image: Image, ele: OpencvTranslatorMatchEle): number {
        const ctx = image.ctx;
        if (ctx.isVerboseEnabled()) ctx.verbose(`getMatchScore: enter`);
        image = image.resize(this.size);
        const dst = new cv.Mat();
        const mask = new cv.Mat();
        cv.matchTemplate(image.mat, ele.image.mat, dst, cv.TM_CCORR_NORMED, mask);
        const result: any = cv.minMaxLoc(dst, mask);
        const score: number = Math.round(result.maxVal * 100);  // TM_CCORR_NORMED returns [0..1]; change to percentage
        dst.delete();
        mask.delete();
        if (ctx.isDebugEnabled()) ctx.debug(`getMatchScore - exit ${score}`);
        return score;
    }

    private doTranslate(image: Image, idx: number, numContours: number, opts?: {correctChar?: string}): TranslatorChar {
        const ctx = image.ctx;
        if (ctx.isVerboseEnabled()) ctx.verbose(`doTranslate: enter`);
        opts = opts || {};
        const correctChar = opts.correctChar;
        let choices: TranslatorChoice[] = [];
        image = image.resize(this.size);
        const dst = new cv.Mat();
        const mask = new cv.Mat();
        const eles = [...this.singleContourEles, ...this.multiContourEles];
        for (let i = 0; i < eles.length; i++) {
            const ele = eles[i] as OpencvTranslatorMatchEle;
            if (ctx.isVerboseEnabled()) ctx.verbose(`doTranslate: matching template ${i}: ${ele.image.name}, type=${ele.image.mat.type()}`);
            cv.matchTemplate(image.mat, ele.image.mat, dst, cv.TM_CCORR_NORMED, mask);
            const result: any = cv.minMaxLoc(dst, mask);
            const curScore: number = Math.round(result.maxVal * 100);  // TM_CCORR_NORMED returns [0..1]; change to percentage
            choices.push({value: ele.value, score: curScore});
        }
        let resultOpts: {numContours?: number, image?: Image, corrected?: boolean} | undefined;
        if (choices.length > 0) {
            // Sort so the 1st element has the highest score
            choices.sort((e1, e2) => e2.score - e1.score);
            let best = choices[0] as TranslatorChoice;
            // Keep only max choices of them
            const maxTranslatorChoices = this.ocr.cfg.maxTranslatorChoices;
            choices = choices.splice(0, maxTranslatorChoices);
            let corrected = false;
            if (correctChar) {
                if (best.value !== correctChar) {
                    ctx.info(`Correcting character ${idx} from ${best.value} to ${correctChar}`);
                    const eles = numContours > 1 ? this.multiContourEles : this.singleContourEles;
                    const imageCopy = image.getPersistentCopy();
                    cv.matchTemplate(image.mat, imageCopy.mat, dst, cv.TM_CCORR_NORMED, mask);
                    const result: any = cv.minMaxLoc(dst, mask);
                    const curScore: number = Math.round(result.maxVal * 100);  // TM_CCORR_NORMED returns [0..1] to change to percentage
                    eles.push({ image: imageCopy, value: correctChar, numContours });
                    choices.push({value: correctChar, score: curScore});
                    choices.sort((e1, e2) => e2.score - e1.score);
                    best = choices[0] as TranslatorChoice;
                    choices = choices.splice(0, maxTranslatorChoices);
                    corrected = true;
                    ctx.info(`Corrected score: ${curScore}, corrected choices: ${JSON.stringify(choices)}`);
                }
            }
            resultOpts = {image, numContours, corrected};
        }
        dst.delete();
        mask.delete();
        if (ctx.isDebugEnabled()) ctx.debug(`doTranslate exit - choices=${JSON.stringify(choices)}`);
        return new TranslatorChar(choices, resultOpts);
    }

}
