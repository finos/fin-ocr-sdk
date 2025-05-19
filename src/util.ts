/**
 * Copyright (c) 2024 Capital One
*/
import { cv } from "./ocv.js";
import { ImageFormat } from "./image.js";
import { Contour, FilterContourOpts } from "./contour.js";
import { encode, decode } from "base64-arraybuffer-es6";
import { loadJimp } from './jimp.js';

let Jimp: typeof import('jimp');

(async () => {
    Jimp = await loadJimp();
})();

export interface MinMax {
    min: number;
    max: number;
}

export interface MinMaxRect {
    x: MinMax;
    y: MinMax;
}

export interface IPoint {
    x: number;
    y: number;
}

export interface DegreeResult {
    degree: number;
    rawDegree?: number;
    path: string;
    rise: number;
    run: number;
}

export interface DebuggableRequest {
    debug?: string[];
}

export type Env = { [name: string]: string | undefined };

export class Util {

    /**
     * Determine if a generic debuggable request should be debugged.
     * @param req Any debuggable request
     * @param category A category to debug
     * @returns true if should debug; otherwise, false;
     */
    public static debug(req: DebuggableRequest, category: string): boolean {
        const categories = req.debug;
        if (!categories) return false;
        if (categories.indexOf("*") >= 0) return true;
        return categories.indexOf(category) >= 0;
    }

    public static bufferToMat(buf: ArrayBuffer, opts?: { format?: ImageFormat }): cv.Mat {
        opts = opts || {};
        const format = opts.format || ImageFormat.JPG;
        if (!Jimp.decoders) {
            throw new Error(`Jimp.decoders is undefined`);
        }
        let imageData: any;
        try {
            imageData = Jimp.decoders[format](Buffer.from(buf));
        } catch (e: any) {
            throw new Error(`Failed to decode ${format}: ${e.message}`)
        }
        //const width = 20;
        //const height = 20;
        //const imageData = new ImageData(new Uint8ClampedArray(buf),width,height);
        const mat = cv.matFromImageData(imageData);
        return mat;
    }

    public static async matToBuffer(mat: cv.Mat, opts?: { format?: ImageFormat }): Promise<ArrayBuffer> {
        opts = opts || {};
        const format = opts.format || ImageFormat.JPG;
        return await Util.matToJimp(mat).getBufferAsync(format);
    }

    private static matToJimp(mat: cv.Mat): any {
        if (mat === undefined) {
            throw new Error("matToJimp: mat is undefined.");
        }
        if (mat.data === undefined) {
            throw new Error("matToJimp: mat.data is undefined.");
        }
        if (mat.rows == undefined) {
            throw new Error("matToJimp: mat.rows is undefined.");
        }
        if (mat.cols === undefined) {
            throw new Error("matToJimp: mat.cols is undefined.");
        }
        if (mat.channels == undefined) {
            throw new Error("matToJimp: mat.channels function is undefined.");
        }
        const height = mat.rows;
        const width = mat.cols;
        const channels = mat.channels();
        if (channels !== 1 && channels !== 3 && channels !== 4) {
            console.error("Captured image with an element size of ", channels);
            throw new Error("matToJimp: Can only support Gray Scale, RGB or RGBA images.");
        }
        const array = new Uint8Array(mat.data);
        const jimp = new Jimp(width, height);
        if (channels === 1) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let idx = y * width + x;
                    let grayScaleValue = array[idx] as number;
                    jimp.setPixelColor(Jimp.rgbaToInt(grayScaleValue, grayScaleValue, grayScaleValue, 255), x, y);
                }
            }
        } else {
            let alpha = 255;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * channels;
                    const red = array[idx] as number;
                    const green = array[idx + 1] as number;
                    const blue = array[idx + 2] as number;
                    if (channels === 4) {
                        alpha = array[idx + 3] as number;
                    }
                    jimp.setPixelColor(Jimp.rgbaToInt(red, green, blue, alpha), x, y);
                }
            }
        }
        return jimp;
    }

    // Return true if the rectangle touches a border, or if specified, any of the specified borders.
    public static rectTouchesBorder(rect: cv.Rect, mat: cv.Mat, borders?: string[]): boolean {
        borders = borders || ["top", "bottom", "right", "left"];
        const size = mat.size();
        for (const border of borders) {
            if (border == "top") {
                if (rect.y <= 0) return true;                         // touches top
            } else if (border == "bottom") {
                if (rect.y + rect.height >= size.height) return true; // touches bottom
            } else if (border == "left") {
                if (rect.x <= 0) return true;                         // touches left
            } else if (border == "right") {
                if (rect.x + rect.width >= size.width) return true;   // touches right
            } else {
                throw new Error(`Invalid border: ${border}`);
            }
        }
        return false;
    }

    // Return true if r1 contains r2
    public static rectContains(r1: cv.Rect, r2: cv.Rect): boolean {
        if (r1.x > r2.x) return false;                             // part of r2 is left of r1
        if (r1.x + r1.width < r2.x + r2.width) return false;       // part of r2 is right of r1
        if (r1.y > r2.y) return false;                             // part of r2 is above r1
        if (r1.y + r1.height < r2.y + r2.height) return false;     // part of r2 is below r1
        return true;
    }

    // Returns true if rect 'r' contains point 'p'
    public static rectContainsPoint(r: cv.Rect, p: cv.Point): boolean {
        if (p.x < r.x || p.x > r.x + r.width) return false;
        if (p.y < r.y || p.y > r.y + r.height) return false;
        return true;
    }

    public static rectClone(r: cv.Rect): cv.Rect {
        return new cv.Rect(r.x, r.y, r.width, r.height);
    }

    // Return true if r1 intersects r2
    public static intersects(r1: cv.Rect, r2: cv.Rect): boolean {
        if (!Util.xIntersects(r1, r2)) return false;
        if (!Util.yIntersects(r1, r2)) return false;
        return true;
    }

    // Return true if r1 intersects r2 on the x-axis
    public static xIntersects(r1: cv.Rect, r2: cv.Rect): boolean {
        if (r1.x > r2.x + r2.width) return false;                  // r1 right of r2
        if (r1.x + r1.width < r2.x) return false;                  // r1 left of r2
        return true;
    }

    // Return true if r1 intersects r2 on the y-axis
    public static yIntersects(r1: cv.Rect, r2: cv.Rect): boolean {
        if (r1.y > r2.y + r2.height) return false;                 // r1 below r2
        if (r1.y + r1.height < r2.y) return false;                 // r1 above r2
        return true;
    }

    // Return true if r1 contains r2
    public static minMaxContains(r1: MinMax, r2: MinMax): boolean {
        if (r1.min > r2.min) return false;
        if (r1.max < r2.max) return false;
        return true;
    }

    public static minMaxIntersects(r1: MinMax, r2: MinMax): boolean {
        if (r1.min > r2.max) return false;
        if (r1.max < r2.min) return false;
        return true;
    }

    // Calculate the fraction of r2 that intersects r1 as a value between [0,1]
    public static fractionIntersects(r1: MinMax, r2: MinMax): number {
        // If there is no intersection, then the fraction is 0
        if (!Util.minMaxIntersects(r1, r2)) return 0;
        // Compute "outside" as the total of r2 that lies outside of the range of r1
        let outside = 0;
        if (r2.min < r1.min) outside += r1.min - r2.min;
        if (r2.max > r1.max) outside += r2.max - r1.max;
        const total = r2.max - r2.min;
        const inside = total - outside;
        // Return the fraction of the r2 points that lie "inside" the range of r1
        return inside / total;
    }

    // Pad the min and max values by up to "pad" without exceeding the absolute range of [0,maxMax].
    public static padMinMax(mm: MinMax, pad: number, maxMax: number): MinMax {
        return {
            min: Math.max(0, mm.min - pad),
            max: Math.min(maxMax, mm.max + pad),
        };
    }

    // Get the intersection of two rectangles, or undefined if there is none
    public static getIntersectingRect(r1: cv.Rect, r2: cv.Rect): cv.Rect | undefined {
        const X = Math.max(r1.x, r2.x);
        const Y = Math.max(r1.y, r2.y);
        const W = Math.min(r1.x + r1.width, r2.x + r2.width) - X;
        const H = Math.min(r1.y + r1.height, r2.y + r2.height) - Y;
        if (W < 0 || H < 0) return undefined;
        return new cv.Rect(X, Y, W, H);
    }

    public static getBoundingMat(mat: cv.Mat, rects: cv.Rect[]): cv.Mat {
        const rect = Util.getBoundingRectOfRects(rects);
        return mat.roi(rect);
    }

    // Get a single rectangle around all of the rectangles
    public static getBoundingRectOfRects(rects: cv.Rect[]): cv.Rect {
        if (rects.length == 0) {
            return new cv.Rect(0, 0, 0, 0);
        }
        let minX = Number.MAX_VALUE;
        let minY = Number.MAX_VALUE;
        let maxX = 0;
        let maxY = 0;
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i] as cv.Rect;
            const x1 = rect.x;
            const y1 = rect.y;
            const x2 = rect.x + rect.width;
            const y2 = rect.y + rect.height;
            minX = Math.min(minX, x1);
            minY = Math.min(minY, y1);
            maxX = Math.max(maxX, x2);
            maxY = Math.max(maxY, y2);
        }
        const X = minX;
        const Y = minY;
        const W = maxX - minX;
        const H = maxY - minY;
        const rect = new cv.Rect(X, Y, W, H);
        return rect;
    }

    // Return true if r1 contains r2 on the Y-axis
    public static yContains(r1: cv.Rect, r2: cv.Rect): boolean {
        if (r1.y > r2.y) {                        // part of r2 is above r1
            return false;
        }
        if (r1.y + r1.height < r2.y + r2.height) { // part of r2 is below r1
            return false;
        }
        return true;
    }

    public static distance(p1: IPoint, p2: IPoint): number {
        return Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }

    public static xDistance(r1: cv.Rect, r2: cv.Rect): number {
        const r1x1 = r1.x;
        const r2x1 = r2.x;
        const r1x2 = r1.x + r1.width;
        const r2x2 = r2.x + r2.width;
        if (r1x2 < r2x1) return r2x1 - r1x2;  // r1 is left of r2
        if (r1x1 > r2x2) return r1x1 - r2x2;  // r1 is right of r2
        return 0;
    }

    public static drawRect(mat: cv.Mat, rect: cv.Rect, color: cv.Scalar, thickness: number, pad: number) {
        const pt1 = new cv.Point(rect.x - pad, rect.y - pad);
        const pt2 = new cv.Point(rect.x + rect.width + pad, rect.y + rect.height + pad);
        cv.rectangle(mat, pt1, pt2, color, thickness);
    }

    public static printStack(msg?: string) {
        if (msg) console.log(msg);
        console.log(Util.getStack());
    }

    public static getStack() {
        const err = new Error();
        return err.stack;
    }

    public static bufferToBase64(buf: ArrayBuffer): string {
        return encode(buf);
    }

    public static base64ToBuffer(str: string): ArrayBuffer {
        return decode(str);
    }

    public static removeLeadingZeros(str?: string): string {
        if (!str) return "";
        return str.replace(/^0+/, '');
    }

    public static removeSpaces(str?: string): string {
        if (!str) return "";
        return str.replace(/\s/g, '');
    }

    // Get the index of the first string in 'strs' that contains 'str'.
    public static getIndexOfFirstContaining(strs: string[], str: string): number {
        for (let i = 0; i < strs.length; i++) {
            if ((strs[i] as string).indexOf(str) >= 0) return i;
        }
        return -1;
    }

    // Is 'str' a numeric string
    public static isNumeric(str: string): boolean {
        return /^-?\d+$/.test(str);
    }

    // Get the X value in the middle of this rectangle
    public static midX(rect: cv.Rect): number {
        return rect.x + (rect.width / 2);
    }

    public static midY(rect: cv.Rect): number {
        return rect.y + (rect.height / 2);
    }

    public static midPoint(x1: number, y1: number, x2: number, y2: number): cv.Point {
        return new cv.Point( Math.round((x1+x2)/2), Math.round((y1+y2)/2) );
    }

    // Get average of an array of numbers
    public static average(nums: number[]): number {
        const sum = nums.reduce((a, b) => a + b, 0);
        return (sum / nums.length) || 0;
    }

    // Get the standard deviation
    public static std(nums: number[], average?: number): number {
        const avg = average || Util.average(nums);
        nums = nums.map((k) => { return (k - avg) ** 2 });
        const sum = nums.reduce((acc, curr) => acc + curr, 0);
        const variance = sum / nums.length;
        return Math.sqrt(variance);
    }

    // Get a random string of certain length
    public static randString(len: number): string {
        return Math.random().toString(36).substring(2, 2 + len);
    }

    public static getStr(name: string, env: Env, def: string): string {
        const val = name in env ? env[name] : undefined;
        if (val) return val;
        return def;
    }

    public static getNum(name: string, env: Env, def: number): number {
        const val = name in env ? env[name] : undefined;
        if (val) return parseFloat(val);
        return def;
    }

    public static getOptStr(name: string, env: Env): string | undefined {
        return env[name];
    }

    public static getOptNum(name: string, env: Env): number | undefined {
        const val = name in env ? env[name] : undefined;
        if (val) return parseFloat(val);
        return undefined;
    }

    public static getVertices(mat: cv.Mat): number[][] {
        const data = mat.data32S;
        const rtn: number[][] = [];
        for (let i = 0; i < data.length + 1; i += 2) {
            const x = data[i] as number;
            const y = data[i + 1] as number;
            if (Number.isNaN(x) || Number.isNaN(y)) continue;
            rtn.push([x, y]);
        }
        return rtn;
    }

    public static toMinMaxRect(rect: cv.Rect): MinMaxRect {
        return {
            x: {min: rect.x, max: rect.x + rect.width - 1},
            y: {min: rect.y, max: rect.y + rect.height - 1},
        };
    }

    public static fromMinMaxRect(rect: MinMaxRect): cv.Rect {
        return {
            x: rect.x.min,
            y: rect.y.min,
            width: rect.x.max - rect.x.min + 1,
            height: rect.y.max - rect.y.min + 1,
        };
    }

    public static inRect(x: number, y: number, rect: MinMaxRect): boolean {
        if (x < rect.x.min) return false;
        if (x > rect.x.max) return false;
        if (y < rect.y.min) return false;
        if (y > rect.y.max) return false;
        return true;
    }

    /**
     * Enlarge a rectangle by some padding amount.
     * @param rect The original rectangle
     * @param size The max size.
     * @param tPad The amount of top padding to add to rect
     * @returns The top padded rectangle
     */
    public static enlargeRect(rect: cv.Rect, size: cv.Size, opts?: {lpad?: number, rpad?: number, tpad?: number, bpad?: number, pad?: number}): cv.Rect {
        opts = opts || {};
        const lpad = opts.lpad || opts.pad || 0;
        const rpad = opts.rpad || opts.pad || 0;
        const tpad = opts.tpad || opts.pad || 0;
        const bpad = opts.tpad || opts.pad || 0;
        const X = Math.max(0, rect.x - lpad);
        const Y = Math.max(0, rect.y - rpad);
        const W = Math.min(size.width - X, rect.width + lpad + rpad);
        const H = Math.min(size.height - Y, rect.height + tpad + bpad);
        rect = new cv.Rect(X, Y, W, H);
        return rect;
    }

    public static radianToDegree(radian: number): number {
        return radian * 180 / Math.PI;
    }

    public static getDegree(points: IPoint[]): number {
        return this.computeDegree(points).degree;
    }

    // Given two or more points, compute the degrees between (0,360] which indicates the direction.
    // The least squared method is used to find a line of best fit.
    public static computeDegree(points: IPoint[]): DegreeResult {
        if (points.length < 2) throw new Error(`a minumum of two points is required in order to compute the degrees`);
        const start = 0;
        const end = points.length - 1;
        // Compute rise and run using least squares method
        let count = 0;
        let xSum = 0;
        let ySum = 0;
        let xxSum = 0;
        let xySum = 0;
        for (let i = start; i <= end; i++) {
            const p = points[i] as IPoint;
            xSum += p.x;
            ySum += p.y;
            xxSum += p.x * p.x;
            xySum += p.x * p.y;
            count++;
        }
        let rise = count * xySum - xSum * ySum;
        let run = count * xxSum - xSum * xSum;
        // If no change in X for any points, rise and run are 0,
        const sp = points[start] as IPoint;
        const ep = points[end] as IPoint;
        let degree: number;
        let rawDegree: number | undefined;
        let path = "";
        // If no change in X for any points, rise and run are 0, so special case above and below
        if (rise == 0 && run == 0) {
            if (ep.y < sp.y) {
                degree = 90;  // up
                path = "up";
            } else {
                degree = 270; // down
                path = "down";
            }
        } else {
            const xg = ep.x - sp.x > 0;
            const yg = ep.y - sp.y > 0;
            const slope = rise/run;
            const radian = Math.atan(slope);
            rawDegree = Util.radianToDegree(radian);
            // Adjust degrees based on direction
            if (rawDegree == 0) {
                if (xg) {
                    degree = 0;
                    path = "right";
                } else {
                    degree = 180;
                    path = "left";
                }
            } else if (xg) {
                if (yg) {
                    degree = 360 - rawDegree;  // down-right
                    path = "down-right";
                } else {
                    degree = -rawDegree;  // up-right
                    path = "up-right";
                }
            } else {
                if (yg) {
                    degree = 180 - rawDegree;   // down-left
                    path = "down-left";
                } else {
                    degree = 180 - rawDegree;   // up-left
                    path = "up-left";
                }
            }
        }
        return { degree, rawDegree, path, rise, run };
    }

    public static degreeRotate(degree: number, rotation: number): number {
        return this.degreeNormalize(degree + rotation);
    }

    public static degreeRight(degree: number): number {
        return this.degreeRotate(degree, -90);
    }

    public static degreeLeft(degree: number): number {
        return this.degreeRotate(degree, 90);
    }

    public static degreeNormalize(degree: number): number {
        degree = degree % 360;
        if (degree < 0) degree = 360 + degree;
        return degree;
    }

    public static degreeDelta(d1: number, d2: number): number {
        let delta = Math.abs(d2 - d1);
        if (delta > 180) delta = 360 - delta;
        return delta;
    }

    public static degreeAverage(d1: number, d2: number): number {
        let avg = (d1 + d2) / 2;
        if (Math.abs(d1 - d2) > 180) avg = Util.degreeRotate(avg, 180);
        return avg;
    }

    public static testComputeDegree() {
        let failures = 0;
        const test = function(name: string, points: IPoint[], expectedDegree: number) {
            const dr = Util.computeDegree(points);
            const degree = Math.round(dr.degree);
            if (degree == expectedDegree) {
                console.log(`PASS: ${name}: ${JSON.stringify(dr)}`);
            } else {
                failures++;
                console.log(`FAIL: ${name}: expected ${expectedDegree}, found ${JSON.stringify(dr)}`);
            }
        };
        test("right",[{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], 0);
        test("up-right",[{ x: 0, y: 0 }, { x: 50, y: -50 }, { x: 100, y: -100 }], 45);
        test("up",[{ x: 0, y: 0 }, { x: 0, y: -50 }, { x: 0, y: -100 }], 90);
        test("up-left",[{ x: 0, y: 0 }, { x: -50, y: -50 }, { x: -100, y: -100 }], 135);
        test("left",[{ x: 0, y: 0 }, { x: -50, y: 0 }, { x: -100, y: 0 }], 180);
        test("down-left",[{ x: 0, y: 0 }, { x: -50, y: 50 }, { x: -100, y: 100 }], 225);
        test("down",[{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 0, y: 100 }], 270);
        test("down-right",[{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }], 315);
        test("> 0",[{ x: 0, y: 0 }, { x: 50, y: -1 }, { x: 100, y: -2 }], 1);
        test("< 90", [{ x: 0, y: 0 }, { x: 1, y: -50 }, { x: 2, y: -100 }], 89);
        test("> 90", [{ x: 0, y: 0 }, { x: -1, y: -50 }, { x: -2, y: -100 }], 91);
        test("< 180", [{ x: 0, y: 0 }, { x: -50, y: -1 }, { x: -100, y: -2 }], 179);
        test("> 180", [{ x: 0, y: 0 }, { x: -50, y: 1 }, { x: -100, y: 2 }], 181);
        test("< 270", [{ x: 0, y: 0 }, { x: -1, y: 50 }, { x: -2, y: 100 }], 269);
        test("> 270", [{ x: 0, y: 0 }, { x: 1, y: 50 }, { x: 2, y: 100 }], 271);
        test("< 360", [{ x: 0, y: 0 }, { x: 50, y: 1 }, { x: 100, y: 2 }], 359);
    }

    public static walkClockwise(r: MinMaxRect, cb: (x: number, y: number) => void) {
        for (let x = r.x.min; x <= r.x.max; x++) cb(x, r.y.min);  // top
        for (let y = r.y.min; y <= r.y.max; y++) cb(r.x.max, y);  // right
        for (let x = r.x.max; x >= r.x.min; x--) cb(x, r.y.max);  // bottom
        for (let y = r.y.max; y >= r.y.min; y--) cb(r.x.min, y);  // bottom
    }

    public static filterContours(contours: Contour[], filter: FilterContourOpts): Contour[] {
        const rtn: Contour[] = [];
        for (const contour of contours) {
            if (!contour.filter(filter)) rtn.push(contour);
        }
        return rtn;
    }
}
