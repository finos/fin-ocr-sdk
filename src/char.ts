/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { cv } from './ocv.js';
import { Context } from "./context.js";
import { Image } from "./image.js";
import { Line } from "./line.js";
import { Contour } from "./contour.js";
import { Config } from "./config.js";
import { TranslatorChar } from "./translators.js";
import { Util } from "./util.js";

export class Char {

    public idx: number;
    public readonly contours: Contour[];
    public readonly rect: cv.Rect;
    public readonly line: Line;
    public readonly hasLargeContour: boolean;
    public readonly cfg: Config;
    public readonly ctx: Context;
    private type = 4;

    constructor(idx: number, contours: Contour[], rect: cv.Rect, line: Line) {
        this.idx = idx;
        this.contours = contours;
        this.rect = rect;
        this.line = line;
        this.ctx = line.ctx;
        this.hasLargeContour = this.getHasLargeContour();
        this.cfg = line.ocr.cfg;
    }

    private getHasLargeContour(): boolean {
        for (const contour of this.contours) {
            if (contour.isLarge()) return true;
        }
        return false;
    }

    public setIndex(idx: number) {
        if (this.idx !== idx) {
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`Changing character ${this.idx} to ${idx}`);
            this.idx = idx;
        }
    }

    public translate(): TranslatorChar {
        return this.line.ocr.translators.opencv.translateChar(this);
    }

    public toImage(): Image {
        return this.line.image.roi(`line-${this.line.idx}-char-${this.idx}`, this.rect);
    }

    public getType(): number {
        return this.type;
    }

    public setType(type: number, adjustChar?: Char) {
        this.type =  type;
        if (this.ctx.isVerboseEnabled()) this.ctx.verbose(`char.setType of character ${this.idx} to type ${type}`);
        if (type === 3 && adjustChar) {
            this.adjust(adjustChar.rect);
        }
    }

    public isNear(other: Char, right: boolean): boolean {
        const estimateRect = this.getEstimateRect(right, false);
        const intersects = Util.intersects(other.rect, estimateRect);
        if (this.ctx.isVerboseEnabled()) this.ctx.verbose(`intersects=${intersects}, other=${JSON.stringify(other.rect)}, estimate=${JSON.stringify(estimateRect)}`);
        // The bottom of this character extends below the middle of it's neighbor
        const middleOfNeighbor = other.rect.y + Math.round(other.rect.height/2);
        const isLowEnough = other.rect.y + other.rect.height > middleOfNeighbor;
        const near = intersects && isLowEnough;
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`isNear: ${this.idx}=${JSON.stringify(this.rect)} to ${other.idx}=${JSON.stringify(other.rect)}, near=${near}, intersects=${intersects}, isLowEnough=${isLowEnough}`);
        return near;
    }

    public contains(other: Char, right: boolean): boolean {
        const estimateRect = this.getEstimateRect(right, true);
        if (!Util.yContains(estimateRect, other.rect)) {
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`contains: y=false, idx=${this.idx}, otherIdx=${other.idx}, right=${right}, estimate=${JSON.stringify(estimateRect)}, other=${JSON.stringify(other.rect)}`);
            return false;
        }
        /*
        const dist = Util.xDistance(this.rect, other.rect);
        if (dist > this.cfg.maxSpaceBetweenWords) {
            log.debug(`contains: x=false, idx=${this.idx}, dist ${dist} > ${this.cfg.maxSpaceBetweenWords}, otherIdx=${other.idx}, right=${right}, this=${JSON.stringify(this.rect)}, other=${JSON.stringify(other.rect)}`);
            return false;
        }
        */
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`contains: true, idx=${this.idx}, otherIdx=${other.idx}, right=${right}, estimate=${JSON.stringify(estimateRect)}, other=${JSON.stringify(other.rect)}`);
        return true;
    }

    private getEstimateRect(right: boolean, containment: boolean): cv.Rect {
        const lPad = containment? 5 : 0;
        const rPad = containment? 5: 0;
        const tPad = containment? 5: 0;
        const bPad = containment? 5: 0;
        const width = containment ? this.cfg.maxCharWidth : this.rect.width;
        const height = containment ? this.cfg.maxCharHeight : this.rect.height;
        const X = right ? this.rect.x + this.rect.width - lPad: this.rect.x - width - lPad - rPad;
        const Y = this.rect.y - tPad;
        const W = width + lPad + rPad;
        const H = height + tPad + bPad;
        return new cv.Rect(X, Y, W, H);
    }

    public adjust(rect: cv.Rect) {
        const r: any = this.rect;
        const mm = this.getMinAndMaxX(rect.y, rect.y + rect.height);
        if (mm) {
            r.oldX = this.rect.x;
            r.oldWidth = this.rect.width;
            this.rect.x = mm.min;
            this.rect.width = mm.max - mm.min + 1;
        }
        r.oldY = this.rect.y;
        r.oldHeight = this.rect.height;
        this.rect.y = rect.y;
        this.rect.height = rect.height;
    }

    /*
     * Get the min and max X value within a particular Y range of all points of this character.
     */
    private getMinAndMaxX(minY: number, maxY: number): MaxMin | undefined {
        let rtn: MaxMin | undefined;
        for (const contour of this.contours) {
            const data = contour.mat.data32S;
            for (let i = 0; i < data.length - 1; i += 2) {
                const x = Math.round(data[i] as number);
                const y = Math.round(data[i + 1] as number);
                if (Number.isNaN(x) || Number.isNaN(y)) continue;
                if (y >= minY && y <= maxY) {
                    if (rtn) {
                        rtn.max = Math.max(rtn.max, x);
                        rtn.min = Math.min(rtn.min, x);
                    } else {
                        rtn = { max: x, min: x };
                    }
                }
            }
        }
        return rtn;
    }

}

interface MaxMin {
    max: number;
    min: number;
}
