/**
 * Copyright (c) 2024 Discover Financial Services
*/
import {Context} from "./context.js";

export class Config {

    public static fromEnv(env: {[name: string]: (string | undefined)}): Config {
        const cfg = new Config();
        cfg.setEnv(env);
        return cfg;
    }

    public avgCharHeight = 24;
    public avgCharWidth = 19;
    public avgSpaceBetweenChars = 7;
    public cleanDimension = 2;
    public cleanHeight = 2;
    public cleanWidth = 2;
    public font = "micr_e13b";
    public logVerticesOfOverlaps = false;
    public minCharArea = 240;
    public minCharAreaFraction = 0.4;
    public minCharAreaSum = 75;
    public minContourArea = 20;
    public minContourHeight = 7;
    public minContourWidth = 3;
    public minMultiContourCharHeight = 16;
    public minMultiContourCharWidth = 14;
    public minSingleContourCharHeight = 23;
    public minSingleContourCharWidth = 10;
    public maxCharHeight = 30;
    public maxCharWidth = 28;
    public maxCharArea = 30 * 28;
    public maxContoursPerChar = 3;
    public maxSpaceBetweenCharsOfWord = 15;
    public maxSpaceBetweenContoursOfSameChar = 8;
    public maxSpaceBetweenWords = 200;
    public maxTranslatorChoices = 3;
    public showMatches = false;
    public tesseractBlackOnWhite = false;
    public tesseractPSM = "13";
    public translators = "tesseract,opencv";
    public yLinePad = 5;
    public debugImageDir = "";
    public logLevel = "info";
    public slowRequestMs = 0;
    public hungRequestMs = 0;
    public slowOrHungRequestLogLevel = "debug";
    public overlapCorrection = true;
    public overlapPadding = 5;

    constructor() {}

    public merge(opts: ConfigOpts) {
        this.avgCharHeight = opts.avgCharHeight || this.avgCharHeight;
        this.avgCharWidth = opts.avgCharWidth || this.avgCharWidth;
        this.avgSpaceBetweenChars = opts.avgSpaceBetweenChars || this.avgSpaceBetweenChars;
        this.cleanDimension = opts.cleanDimension || this.cleanDimension;
        this.cleanHeight = opts.cleanHeight || this.cleanHeight;
        this.cleanWidth = opts.cleanWidth || this.cleanWidth;
        this.font = opts.font || this.font;
        this.logVerticesOfOverlaps = 'logVerticesOfOverlaps' in opts ? opts.logVerticesOfOverlaps as boolean : this.logVerticesOfOverlaps;
        this.minCharArea = opts.minCharArea || this.minCharArea;
        this.minCharAreaSum = opts.minCharAreaSum || this.minCharAreaSum;
        this.minContourArea = opts.minContourArea || this.minContourArea;
        this.minContourHeight = opts.minContourHeight || this.minContourHeight;
        this.minContourWidth = opts.minContourWidth || this.minContourWidth;
        this.minMultiContourCharHeight = opts.minMultiContourCharHeight || this.minMultiContourCharHeight;
        this.minMultiContourCharWidth = opts.minMultiContourCharWidth || this.minMultiContourCharWidth;
        this.minSingleContourCharHeight = opts.minSingleContourCharHeight || this.minSingleContourCharHeight;
        this.minSingleContourCharWidth = opts.minSingleContourCharWidth || this.minSingleContourCharWidth;
        this.maxCharHeight = opts.maxCharHeight || this.maxCharHeight;
        this.maxCharWidth = opts.maxCharWidth || this.maxCharWidth;
        this.maxCharArea = opts.maxCharArea || this.maxCharArea;
        this.maxContoursPerChar = opts.maxContoursPerChar || this.maxContoursPerChar;
        this.maxSpaceBetweenCharsOfWord = opts.maxSpaceBetweenCharsOfWord || this.maxSpaceBetweenCharsOfWord;
        this.maxSpaceBetweenContoursOfSameChar = opts.maxSpaceBetweenContoursOfSameChar || this.maxSpaceBetweenContoursOfSameChar;
        this.maxSpaceBetweenWords = opts.maxSpaceBetweenWords || this.maxSpaceBetweenWords;
        this.maxTranslatorChoices = opts.maxTranslatorChoices || this.maxTranslatorChoices;
        this.showMatches = 'showMatches' in opts ? opts.showMatches as boolean: this.showMatches;
        this.tesseractBlackOnWhite = 'tesseractBlackOnWhite' in opts ? opts.tesseractBlackOnWhite as boolean: this.tesseractBlackOnWhite;
        this.tesseractPSM = opts.tesseractPSM || this.tesseractPSM;
        this.translators = opts.translators || this.translators;
        this.yLinePad = opts.yLinePad || this.yLinePad;
        this.debugImageDir = 'debugImageDir' in opts ? opts.debugImageDir as string: this.debugImageDir;
        this.logLevel = opts.logLevel || this.logLevel;
        this.slowRequestMs = 'slowRequestMs' in opts ? opts.slowRequestMs as number: this.slowRequestMs;
        this.hungRequestMs = 'hungRequestMs' in opts ? opts.hungRequestMs as number: this.hungRequestMs;
        this.slowOrHungRequestLogLevel = opts.slowOrHungRequestLogLevel || this.slowOrHungRequestLogLevel;
        this.overlapCorrection = 'overlapCorrection' in opts ? opts.overlapCorrection as boolean: this.overlapCorrection;
        this.overlapPadding = opts.overlapPadding || this.overlapPadding;
    }

    /**
     * Given a map of environment variable names, find those starting with "OCR_" and attempt
     * to map them to one of the variables of this class.
     */
    public setEnv(env: {[name: string]: (string | undefined)}) {
        const self: any = this;
        const prefix = "OCR_";
        for (let key of Object.keys(env)) {
            if (!key.startsWith(prefix) || key.length < prefix.length + 1) continue;
            const fieldName = this.varNameToFieldName(key.slice(prefix.length));
            const curValue: any = self[fieldName];
            if (curValue === undefined) throw new Error(`'${key}' is an invalid environment variable name`);
            let newValue: any = env[key];
            if (typeof curValue == "boolean") {
                if (newValue.toLowerCase() === "true") newValue = true;
                else if (newValue.toLowerCase() === "false") newValue = false;
                else throw new Error(`'${key}' is must have value 'true' or 'false' but found '${newValue}'`);
            } else if (typeof curValue == 'number') {
                newValue = parseFloat(newValue);
            } else if (!(typeof curValue == 'string')) {
                throw new Error(`'${key}' is '${typeof curValue}' which is neither 'boolean', 'number', nor 'string'`);
            }
            self[fieldName] = newValue;
        }
    }

    /**
     * Convert an snake-case environment variable name to a camel-case field name.
     * @param varName 
     * @returns 
     */
    private varNameToFieldName(varName: string): string {
        let fieldName = varName.charAt(0).toLowerCase();
        let prevUnderscore = false;
        for (let i = 1; i < varName.length; i++) {
            const c = varName.charAt(i);
            if (c == "_") {
                prevUnderscore = true;
                continue;
            }
            fieldName += prevUnderscore ? c.toUpperCase() : c.toLowerCase();
            prevUnderscore = false;
        }
        return fieldName;
    }

}

export interface ConfigOpts {
    avgCharHeight?: number;
    avgCharWidth?: number;
    avgSpaceBetweenChars?: number;
    cleanDimension?: number;
    cleanHeight?: number;
    cleanWidth?: number;
    font?: string;
    imageDebug?: boolean;
    imageDebugFindMicr?: boolean;
    logVerticesOfOverlaps?: boolean;
    minCharArea?: number;
    minCharAreaSum?: number;
    minContourArea?: number;
    minContourHeight?: number;
    minContourWidth?: number;
    minMultiContourCharHeight?: number;
    minMultiContourCharWidth?: number;
    minSingleContourCharHeight?: number;
    minSingleContourCharWidth?: number;
    maxCharHeight?: number;
    maxCharWidth?: number;
    maxCharArea?: number;
    maxContoursPerChar?: number;
    maxSpaceBetweenCharsOfWord?: number;
    maxSpaceBetweenContoursOfSameChar?: number;
    maxSpaceBetweenWords?: number;
    maxTranslatorChoices?: number;
    tesseractBlackOnWhite?: boolean;
    tesseractPSM?: string;
    translators?: string;
    yLinePad?: number;
    debugImageDir?: string;
    logLevel?: string;
    slowRequestMs?: number;
    hungRequestMs?: number;
    slowOrHungRequestLogLevel?: string;
    overlapCorrection?: boolean;
    overlapPadding?: number;
}
