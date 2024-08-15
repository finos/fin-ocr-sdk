/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { cv } from "./ocv.js";
import { Image } from './image.js';
import { Curve } from './curve.js';
import { Curves } from './curves.js';
import { Context } from './context.js';
import { Util, MinMax } from './util.js';

// Contour sizes:
// S = Smaller than the smallest element of a character 
// M = Medium - character size contours
// L = Larger than the largest character
export enum ContourSize { S="S", M="M", L="L", U="U"};

interface XYMinMax {
    x: MinMax;
    y: MinMax;
}

export interface FilterContourOpts {
    minWidth?: number;
    minHeight?: number;
    minArea?: number;
    maxWidth?: number;
    maxHeight?: number;
    maxArea?: number;
    borders?: string[];  // contours touching these borders will be excluded
};

export class Contour {

    public readonly mat: cv.Mat;
    public readonly image: Image;
    public rect: cv.Rect;
    public ctx: Context;

    public width: number;
    public height: number;
    public area: number;
    public area2: number;
    public size?: ContourSize;
    public inLine = false;
    public overlap = false;
    public midX: number;
    public idx = -1;

    private numSides: number | undefined;

    constructor(mat: cv.Mat, image: Image) {
        this.mat = mat;
        this.image = image;
        this.ctx = image.ctx;
        this.rect = cv.boundingRect(mat);
        this.width = this.rect.width;
        this.height = this.rect.height;
        this.area = this.width * this.height;
        this.area2 = cv.contourArea(mat);
        this.midX = Util.midX(this.rect);
    }

    public filter(opts: FilterContourOpts): boolean {
        const rect = this.rect;
        const mat = this.mat;
        const i = this.idx;
        const borders = opts.borders;
        if (borders && Util.rectTouchesBorder(rect, mat, borders)) {
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`skip contour ${i}, touches one of the ${JSON.stringify(borders)} borders: ${JSON.stringify(rect)}`);
            return true;
        }
        if (opts.minWidth && rect.width < opts.minWidth) {
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`skip contour ${i}, width ${rect.width} < ${opts.minWidth}`);
            return true;
        }
        if (opts.minHeight && rect.height < opts.minHeight) {
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`skip contour ${i}, height ${rect.height} < ${opts.minHeight}`);
            return true;
        }
        if (opts.maxWidth && rect.width > opts.maxWidth) {
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`skip contour ${i}, width ${rect.width} > ${opts.maxWidth}`);
            return true;
        }
        if (opts.maxHeight && rect.height > opts.maxHeight) {
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`skip contour ${i}, height ${rect.height} > ${opts.maxHeight}`);
            return true;
        }
        const area = this.area2;
        if (opts.minArea && area < opts.minArea) {
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`skip contour ${i}, area ${area} < ${opts.minArea}`);
            return true;
        }
        if (opts.maxArea && area > opts.maxArea) {
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`skip contour ${i}, area ${area} > ${opts.maxArea}`);
            return true;
        }
        return false;
    }

    public isSmall(): boolean {
        return this.getSize() === ContourSize.S;
    }

    public isMedium(): boolean {
        return this.getSize() === ContourSize.M;
    }

    public isLarge(): boolean {
        return this.getSize() === ContourSize.L;
    }

    public getSize(): ContourSize {
        if (this.size) return this.size;
        throw new Error(`size has not been set for contour ${this.idx}`);
    }

    public getNumSides(): number {
        if (this.numSides === undefined) {
            const curve = this.mat;
            const approxCurve = new cv.Mat();
            cv.approxPolyDP( curve, approxCurve, 0.01 * cv.arcLength(curve, true), true);
            const count = approxCurve.data.length;
            approxCurve.delete();
            this.numSides = count;
        }
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`getNumSides: numSides=${this.numSides}, idx=${this.idx}`);
        return this.numSides as number;
    }

    public skewAngleV1(): number {
        // Find the correction angle
        const mar = cv.minAreaRect(this.mat);
        let angle: number;
        if (mar.size.width < mar.size.height) {
            angle = -(90 - mar.angle);
        } else {
            angle = mar.angle;
        }
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`Skew angle of contour ${this.idx} is ${angle} (mar=${JSON.stringify(mar)}`);
        return angle;
    }

    public skewAngleV2(): number {
        // Find the correction angle
        const rr = cv.fitEllipse(this.mat);
        let angle = -(rr.angle - 90);
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`Skew angle of contour ${this.idx} is ${angle} (rr=${JSON.stringify(rr)})`);
        return angle;
    }

    public xDistance(otherContour: Contour): number {
        return Util.xDistance(this.rect, otherContour.rect);
    }

    public yIntersects(otherContour: Contour): boolean {
        const myRect = this.rect;
        const otherRect = otherContour.rect;
        if (myRect.y > otherRect.y + otherRect.height) { // this contour is below the other contour
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`yIntersects: contour ${this.idx} to ${otherContour.idx}; no - below`);
            return false;
        }
        if (myRect.y + myRect.height < otherRect.y) {    // this contour is above the other contour
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`yIntersects: contour ${this.idx} to ${otherContour.idx}; no - above`);
            return false;
        }
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`yIntersects: contour ${this.idx} to ${otherContour.idx}; yes`);
        return true;
    }

    // Get the Y range of values for this contour
    public getYRange(): MinMax {
        return {
            min: this.rect.y,
            max: this.rect.y + this.rect.height,
        };
    }

    public adjustY(yRange: MinMax): boolean {
        const mm = this.getMinMaxXY(yRange);
        if (!mm) return false;  // no points are in this Y-range
        const orig = new cv.Rect(this.rect.x, this.rect.y, this.rect.width, this.rect.height);
        this.rect.x = mm.x.min;
        this.rect.y = mm.y.min;
        this.rect.width = Math.max(mm.x.max - mm.x.min, 1);
        this.rect.height = Math.max(mm.y.max - mm.y.min, 1);
        this.adjustRecompute();
        (this.rect as any).orig = orig;
        this.overlap = true;
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`Adjusted contour ${this.idx} from ${JSON.stringify(orig)} to ${JSON.stringify(this.rect)}`);
        return true;
    }

    public adjustRect(rect: cv.Rect): boolean {
        const r = this.getRect(rect);
        if (!r) return false;  // no points are in this rectangle
        const orig = new cv.Rect(this.rect.x, this.rect.y, this.rect.width, this.rect.height);
        this.rect.x = r.x;
        this.rect.y = r.y;
        this.rect.width = r.width;
        this.rect.height = r.height;
        this.adjustRecompute();
        (this.rect as any).orig = orig;
        this.overlap = true;
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`adjusted contour ${this.idx} from ${JSON.stringify(orig)} to ${JSON.stringify(this.rect)}`);
        return true;
    }

    private adjustRecompute() {
        this.width = this.rect.width;
        this.height = this.rect.height;
        this.area = this.width * this.height;
        this.midX = Util.midX(this.rect);
    }

    public getSubContour(rect: cv.Rect): Contour {
        const sub = this.clone();
        (rect as any).orig = sub.rect;
        sub.rect = rect;
        return sub;
    }

    public isMemberOf(contours: Contour[]): boolean {
        for (const c of contours) {
            if (c.idx == this.idx) return true;
        }
        return false;
    }

    // Get the min and max X and Y values for this contour within a particular Y range
    private getMinMaxXY(yRange: MinMax): XYMinMax | undefined {
        let rtn: XYMinMax | undefined;
        // Process each X/Y value for each point comprising this contour
        const data = this.mat.data32S;
        for (let i = 0; i < data.length - 1; i += 2) {
            // Get the X and Y values
            const x = Math.round(data[i] as number);
            const y = Math.round(data[i + 1] as number);
            if (Number.isNaN(x) || Number.isNaN(y)) continue;
            if (y >= yRange.min && y <= yRange.max) {
                // This Y value is in the Y range, so include this X/Y value
                if (rtn) {
                    rtn.x.max = Math.max(rtn.x.max, x);
                    rtn.x.min = Math.min(rtn.x.min, x);
                    rtn.y.max = Math.max(rtn.y.max, y);
                    rtn.y.min = Math.min(rtn.y.min, y);
                } else {
                    rtn = { x:{max:x,min:x}, y:{max:y,min:y} };
                }
            }
        }
        return rtn;
    }

    public performOverlapCorrection(verticalThicknessThreshold: number) {
        const ctx = this.ctx;
        ctx.debug(`overlap: begin correction for contour ${this.idx}`);
        //Curve.clear(this.image, this.rect, verticalThicknessThreshold);
        Curves.clear(this);
        ctx.debug(`overlap: end correction for contour ${this.idx}`);
    }

    // Find all points of this contour which are within 'rect'.  Return the smallest rectangle containing all of these points, or undefined if there are no points.
    private getRect(rect: cv.Rect): cv.Rect | undefined {
        //return this.getRectV1(rect);
        return this.getRectV2(rect);
    }

    private getRectV1(rect: cv.Rect): cv.Rect | undefined {
        if (this.ctx.isVerboseEnabled()) this.ctx.verbose(`contour.getRect - enter: rect=${JSON.stringify(rect)}`);
        let found = false;
        let x1 = Number.MAX_VALUE;
        let y1 = Number.MAX_VALUE;
        let x2 = 0;
        let y2 = 0;
        // Process each X/Y value for each point comprising this contour
        const data = this.mat.data32S;
        for (let i = 0; i < data.length - 1; i += 2) {
            // Get the X and Y values
            const x = Math.round(data[i] as number);
            const y = Math.round(data[i + 1] as number);
            if (Number.isNaN(x) || Number.isNaN(y)) continue;
            const p = new cv.Point(x,y);
            const contains = Util.rectContainsPoint(rect,p);
            if (this.ctx.isVerboseEnabled()) this.ctx.verbose(`contour.getRect idx=${this.idx}, i=${i}, x=${x}, y=${y}, contains=${contains}`);
            if (!contains) continue;
            // This point is in the rectangle, so include it
            if (found) {
                x1 = Math.min(x, x1);
                x2 = Math.max(x, x2);
                y1 = Math.min(y, y1);
                y2 = Math.max(y, y2);
            } else {
                found = true;
                x1 = x;
                x2 = x;
                y1 = y;
                y2 = y;
            }
            if (this.ctx.isVerboseEnabled()) this.ctx.verbose(`contour.getRect ${this.idx}, including point=${x}:${y}, x1=${x1}, x2=${x2}, y1=${y1}, y2=${y2}`);
        }
        if (!found) return undefined;
        const rtn = new cv.Rect(x1, y1, Math.max(x2-x1,1), Math.max(y2-y1,1));
        if (this.ctx.isVerboseEnabled()) this.ctx.verbose(`contour.getRect - exit: rtn=${JSON.stringify(rtn)}`);
        return rtn;
    }

    private getRectV2(rect: cv.Rect): cv.Rect | undefined {
        return this.image.getRect(rect);
    }

    public touchesBorder(borders?: string[]): boolean {
        return Util.rectTouchesBorder(this.rect, this.image.mat, borders);
    }

    public toImage(opts?: {name?: string, type?: number}): Image {
        opts = opts || {};
        const name = opts.name || `contour-${this.idx}`;
        return this.image.roi(name, this.rect, opts);
    }

    public getVertices(): number[][] {
        const data = this.mat.data32S;
        const rtn: number[][] = [];
        for (let i = 0; i < data.length + 1; i += 2) {
            const x = data[i] as number;
            const y = data[i + 1] as number;
            if (Number.isNaN(x) || Number.isNaN(y)) continue;
            rtn.push([x,y]);
        }
        return rtn;
    }

    public logVertices() {
        console.log(`Vertices for contour ${this.idx}: ${JSON.stringify(Util.getVertices(this.mat))}`);
    }

    public clone(): Contour {
        const c = new Contour(this.mat, this.image);
        c.idx = this.idx;
        c.overlap = this.overlap;
        c.size = this.size;
        return c;
    }

    public areaFitRatio(): number {
        return this.area / cv.contourArea(this.mat);
    }

    public distanceFromOrigin(): number {
        return Util.distance({x:0, y:0}, this.rect);
    }

    public toJSON() {
        return { idx: this.idx, size: this.size, overlap: this.overlap, rect: this.rect, area: this.area, area2: this.area2 };
    }

}
