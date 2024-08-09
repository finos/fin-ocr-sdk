/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { cv } from "./ocv.js";
import { OCR } from "./ocr.js";
import { Image } from "./image.js";
import { Contour, ContourSize } from "./contour.js";
import { Color } from "./color.js";
import { Context } from "./context.js";
import { Curves } from "./curve.js";
import { Char } from "./char.js";
import { Config } from "./config.js";
import { TranslatorChoice } from "./translators.js";
import { Util, MinMax, IPoint } from "./util.js";

let count = 0;

/*
 * Manage a single line of an image based on contours.
 * 
 * TERMINOLOGY:
 * - "neighbor" refers to a characters's rectangle that is adjacent to it when sorted
 *   by the X value (i.e. left-to-right).
 * 
 * ASSUMPTIONS:
 * - Skew correction has already been performed
 * 
 * DESIGN:
 * 
 * The logic here is rather complex because it is permissive of the following conditions:
 * - overlap (e.g. signature overlap from line above)
 * - curviture in a line
 * 
 * Each character is classified as having one of the following types (progressively):
 * - type 1: It is inside (i.e. contained by) one of the root character's rectangles.
 *           There must be at least one type 1 character in each line.  The type 1 characters serve as
 *           the anchor points for the remainder of this algorithm.
 * - type 2: The character's bounding rectangle IS CONTAINED BY the expected neighbor rectangle
 *           of a type 1 or type 2 neighbor.  This is what allows us to handle curviture because contours
 *           which curve relative to their neighbor are still included on the line.
 * - type 3: The character's bounding rectangle INTERSECTS an expected neighbor AND the bottom is near the
 *           bottom of expected neighbor.  This is designed to distinquish as best we can between an overlapping
 *           character (which we want to include) versus a contour which extends into the Y range of the line but
 *           is not in overlapping a character (which we don't want to include).
 * - type 4: All other characters.
 * 
 * The line's bounding rectangle is computed by finding the min and max X and Y values as follows:
 * - the X and Y values of type 1 and type 2 rectangles;
 * - only the X values of type 3 rectangles
 * - type 4 rectangles are skipped as they are deemed to be contours which vere into the Y range of the line but
 *   does not overlap any character of the line.
 * 
 * Type 3 characters can extend the rectangle too far in either direction (left or right) when there is an overlapping contour.
 * For example, consider a signature overlap on the last character of a line, but the signature from above extends much further
 * to the right than the real end of the line.  The getMinAndMaxX function is used in this case to get the X values within the
 * Y range of the nearest neighbor instead.
 * 
*/
/**
 * New Algorithm
 * 
 * Add initialContour to the line.  This is a zero from the MICR line.
 * Search left and right of the initialContour, adding contours to the line if it Y-intersects the closest previous contour of character size (CPC) and
 * is contained by the padded projected rectangle (PPR) from CPC.  This adds medium and small contours to the line.
 * If a contour Y-intersects but is not contained (and is large or not small?), add the contour to the "big contour list" (BCL).
 * 
 * Based on existing CPCs, compute a max width and height to use for creating a non-padded projected rectangle (NPR).
 * For each existing contour, create an NPR to the right and left.  If the NPR doesn't intersect the previous and next contour, then do the following:
 *     For each contour BC in BCL, if there is an intersection with the NPR, clone BC and create a rect based on the points in BC which are in NPR,
 *     add this contour to the line.
 * Sort contours left-to
 */
export class Line {

    public image: Image;
    public readonly ocr: OCR;
    public readonly ctx: Context;
    public readonly contours: Contour[] = [];
    public readonly cfg: Config;
    public readonly idx: number;
    public count: number;
    public overlap = false;
    public readonly initialContour: Contour;
    public readonly minCharArea: number;
    public readonly minCharHeight: number;
    public readonly maxCharArea: number;
    public readonly maxCharWidth: number;
    public readonly maxCharHeight: number;
    public readonly minHorizontalCount: number;
    public readonly minVerticalCount: number;
    public readonly verticalThicknessThreshold: number;

    private roots: cv.Rect[] | undefined;
    private chars: Char[] | undefined;
    private rect: cv.Rect | undefined;
    private maxX: number;
    private maxY: number;
    private yRange: MinMax | undefined;
    private containmentPadding: number;
    private minDistBetween: number = Number.MAX_VALUE;

    constructor(idx: number, image: Image, initialContour: Contour, allContours: Contour[], opts?: { minCharArea?: number, minCharHeight?: number, maxCharArea?: number, maxCharWidth?: number, maxCharHeight?: number, containmentPadding?: number}) {
        opts = opts || {};
        this.idx = idx;
        this.initialContour = initialContour;
        this.minCharArea = opts.minCharArea || initialContour.area * 0.5;
        this.minCharHeight = opts.minCharHeight || initialContour.height * 0.75;
        this.maxCharArea = opts.maxCharArea || initialContour.area * 1.5;
        this.maxCharWidth = opts.maxCharWidth || initialContour.width;
        this.maxCharHeight = opts.maxCharHeight || initialContour.height;
        this.containmentPadding = opts.containmentPadding || initialContour.rect.height * 0.25;
        this.minHorizontalCount = Math.round(initialContour.width * 0.3);
        this.minVerticalCount = Math.round(initialContour.height * 0.3);
        this.verticalThicknessThreshold = Math.round(initialContour.height * 0.25);
        this.count = ++count;
        this.image = image;
        this.maxX = image.width - 1;
        this.maxY = image.height - 1;
        this.ctx = image.ctx;
        this.ocr = image.ocr;
        this.cfg = this.ocr.cfg;
        this.setRoots([initialContour.rect]);
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`Created line ${this.idx}, minCharArea=${this.minCharArea}, minCharHeight=${this.minCharHeight}, maxCharArea=${this.maxCharArea}, containmentPadding=${this.containmentPadding}, initialContourIdx=${initialContour.idx}`);
        this.init(allContours);
    }

    private init(contours: Contour[]) {
        const ctx = this.ctx;
        // Add and categorize the initial contour
        this.categorizeContour(this.initialContour);
        this.addContour(this.initialContour);
        // Sort all contours left-to-right
        contours.sort((a, b) => a.rect.x - b.rect.x);
        // Set 'loc' to the index of the initial contour for this line
        const loc = this.findInitialContourLocation(contours);
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`Location of initial contour: ${loc}`);
        // Filter contours to the left of the initial contour
        const ncContours: Contour[] = [];
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`Filtering contours to the left`);
        this.filterContours(contours, loc - 1, false, ncContours);
        // Filter contours to the right of the initial contour
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`Filtering contours to the right`);
        this.filterContours(contours, loc + 1, true, ncContours);
        if (ctx.debugImages) this.image.drawContours({ name: `line-${this.idx}-initial-contours`, contours: this.contours });
        // Process the non-contained contours
        this.processNonContainedContours(ncContours);
        if (ctx.debugImages) this.image.drawContours({ name: `line-${this.idx}-final-contours`, contours: this.contours });
        // Build the characters
        this.chars = this.buildChars();
        // Build the bounding rectangle around all characters of the line
        this.rect = this.buildBoundingRect();
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`Finished initializing line ${this.idx}, overlap=${this.overlap}`);
    }

    private filterContours(contours: Contour[], start: number, right: boolean, ncContours: Contour[]) {
        let lc: Contour = this.initialContour;
        const maxContainWidth = this.maxCharWidth * 1.25;
        for (let i = start; right ? i < contours.length : i >= 0; right ? i++ : i--) {
            let c: Contour | undefined = contours[i] as Contour;
            const range = c.getYRange();
            let intersectionRange = lc.getYRange();
            const intersects = Util.minMaxIntersects(intersectionRange, range);
            this.ctx.trace(`filterContours: idx=${c.idx}, intersects=${intersects}, range=${JSON.stringify(range)}, intersectionRange=${JSON.stringify(intersectionRange)}, rect=${JSON.stringify(c.rect)}`);
            if (intersects) {
                this.categorizeContour(c);
                let containmentRange = Util.padMinMax(intersectionRange, this.containmentPadding, this.maxY);
                const contains = c.width <= maxContainWidth && Util.minMaxContains(containmentRange, range);
                this.ctx.trace(`filterContours: idx=${c.idx}, contains=${contains}, range=${JSON.stringify(range)}, containmentRange=${JSON.stringify(containmentRange)}`);
                if (contains) {
                    if (c.isMedium()) {
                        const dist = Util.xDistance(lc.rect, c.rect);
                        this.minDistBetween = Math.min(this.minDistBetween, dist);
                        lc = c;
                    }
                    this.addContour(c);
                } else {
                    ncContours.push(c);
                }
            }
        }
    }

    private processNonContainedContours(ncContours: Contour[]) {
        const ctx = this.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`pncc enter: numContours=${this.contours.length}, numNCContours=${ncContours.length}`);
        if (ncContours.length === 0) return;
        // HEREHERE: Something here seems to be causing the changes to images
        //if (this.idx > 0) return; // HERE
        // This loop should break much earlier, but choose 10 just to make sure there
        // isn't some condition that would otherwise result in an infinite loop.
        for (let i = 0; i < 10; i++) {
            let contourCount = this.contours.length;
            const projections = this.getProjections();
            if (ctx.debugImages) this.image.drawBoxes(`projections-${i}`, projections);
            if (ctx.isDebugEnabled()) ctx.debug(`pncc iteration=${i}, numProjections=${projections.length}, numContours=${this.contours.length}`);
            for (const p of projections) {
                for (const ncc of ncContours) {
                    const intersects = Util.intersects(p, ncc.rect);
                    if (ctx.isDebugEnabled()) ctx.debug(`pncc intersects=${intersects}, ncc.idx=${ncc.idx}, ncc.rect=${JSON.stringify(ncc.rect)}, p=${JSON.stringify(p)}`);
                    if (!intersects) continue;
                    const c = ncc.clone();
                    const adjusted = c.adjustRect(p);
                    if (adjusted) {
                        this.overlap = true;
                        this.categorizeContour(c);
                        this.addContour(c);
                        if (ctx.isDebugEnabled()) ctx.debug(`pncc removing overlaps from NC contour ${ncc.idx}`);
                    }
                }
            }
            if (ctx.debugImages) this.image.drawContours({name: `line-${this.idx}-contours-${i}`, contours: this.contours});
            // If no new contours were added, we're done
            if (this.contours.length === contourCount) break;
        }
        if (ctx.isDebugEnabled()) this.ctx.debug(`pncc exit`)
    }

    private getProjections(): cv.Rect[] {
        const ctx = this.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`getProjections - enter`);
        // Sort contours left-to-right
        this.contours.sort((a, b) => a.rect.x - b.rect.x);
        // Push projection to the left of the first
        const projections: cv.Rect[] = [];
        // Add projections left-to-right
        this.addProjections(projections, true);
        // Add projections right-to-left
        this.addProjections(projections, false);
        if (ctx.isDebugEnabled()) ctx.debug(`getProjections - exit (${projections.length} projections)`);
        return projections;
    }

    private addProjections(projections: cv.Rect[], right: boolean) {
        const ctx = this.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`addProjections - enter, right=${right}`);
        // Find gaps between contours and insert projections
        const minGap = this.maxCharWidth + this.minDistBetween;
        let lcr: cv.Rect| undefined; // last contour rectangle
        let ly = -1;                 // last Y from a medium contour
        for (let i = right ? 0 : this.contours.length - 1; right ? i < this.contours.length : i >= 0; right ? i++ : i--) {
            const c = this.contours[i] as Contour;
            if (lcr && ly >= 0) {
                const dist = Util.xDistance(lcr, c.rect);
                const foundGap = dist > minGap;
                if (ctx.isDebugEnabled()) ctx.debug(`addProjections.1: foundGap=${foundGap}, c=${c.idx}, dist=${dist}, minGap=${minGap}, ly=${ly}, lcr=${JSON.stringify(lcr)}`);
                if (foundGap) this.addProjection(projections, lcr, ly, right);
            }
            if (c.isMedium()) ly = c.rect.y;
            lcr = c.rect;
            if (!c.isMedium()) if (ctx.isDebugEnabled()) ctx.debug(`addProjections.2: idx=${c.idx}, ly=${ly}, lcr=${JSON.stringify(lcr)}`);
        }
        if (lcr && ly >= 0) this.addProjection(projections, lcr, ly, right);
        if (ctx.isDebugEnabled()) ctx.debug(`addProjections - exit, right=${right}`);
    }

    private addProjection(projections: cv.Rect[], lcr: cv.Rect, ly: number, right: boolean) {
        const ctx = this.ctx;
        const p = this.getProjectedRect(lcr, ly, right);
        if (p.x < 0 || p.y < 0 || p.x + p.width > this.image.width || p.y + p.height > this.image.height) {
            if (ctx.isDebugEnabled()) ctx.debug(`Not adding projection because it is outside of the image boundary`);
            return;
        }
        // Don't add the new projection if it intersects with an existing projection
        for (const p2 of projections) {
            if (Util.intersects(p, p2)) {
                if (ctx.isDebugEnabled()) ctx.debug(`Not adding projection because it intersects an existing projection`);
                return;
            }
        }
        if (ctx.isDebugEnabled()) ctx.debug(`Adding projection ${JSON.stringify(p)} to the ${right?"right":"left"}, ly=${ly}, lcr=${JSON.stringify(lcr)}`);
        projections.push(p);
    }

    private getProjectedRect(rect: cv.Rect, y: number, right: boolean): cv.Rect {
        let W = this.maxCharWidth;
        let H = this.maxCharHeight;
        const distBetween = this.minDistBetween * 1.3;
        let X = right ? rect.x + rect.width + distBetween : rect.x - distBetween - W;
        return new cv.Rect(X, y, W, H);
    }

    private addContour(contour: Contour): Contour {
        const ctx = this.ctx;
        // If this contour is already a member of another line, clone it just to be safe in case it is updated by one line and not another
        if (contour.inLine) contour = contour.clone();
        // Add contour to this line
        this.contours.push(contour);
        contour.inLine = true;
        if (ctx.isDebugEnabled()) ctx.debug(`Added contour ${contour.idx} of size ${contour.size} to line ${this.idx}`);
        return contour;
    }

    private findInitialContourLocation(contours: Contour[]): number {
        for (let i = 0; i < contours.length; i++) {
            if (contours[i] === this.initialContour) {
                return i;
            };
        }
        throw new Error(`Initial contour for line ${this.idx} was not found in the list of contours`);
    }

    private categorizeContour(contour: Contour) {
        if (contour.area > this.maxCharArea) contour.size = ContourSize.L;
        else if (contour.area < this.minCharArea || contour.height < this.minCharHeight) contour.size = ContourSize.S;
        else contour.size = ContourSize.M;
    }

    public setRoots(roots: cv.Rect[]) {
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`setting roots to ${JSON.stringify(roots)}`);
        this.roots = roots;
    }

    public isInitialized(): boolean {
        return this.chars != undefined;
    }

    public getChars(): Char[] {
        if (this.chars) return this.chars;
        throw new Error(`line has not been initialized`);
    }

    public getBoundingRect(): cv.Rect {
        if (this.rect) return this.rect;
        throw new Error(`line has not been initialized`);
    }

    private getDefaultRoots(chars: Char[]): cv.Rect[] {
        const ctx = this.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`getting default roots for line ${this.idx}`);
        if (chars.length === 0) throw new Error(`Empty character array`);
        const translator = this.ocr.translators.opencv;
        let bestScore = 0;
        let bestValue = "";
        let bestChar: Char = chars[0] as Char;
        for (const char of chars) {
            if (char.rect.height > this.cfg.maxCharHeight) continue;
            if (char.rect.width > this.cfg.maxCharWidth) continue;
            const result = translator.translateChar(char);
            const choices = result.choices;
            if (choices.length > 0) {
                const best = choices[0] as TranslatorChoice;
                if (best.score > bestScore) {
                    bestScore = best.score;
                    bestValue = best.value;
                    bestChar = char;
                    if (ctx.isDebugEnabled()) ctx.debug(`getDefaultRoots: new best ${JSON.stringify(result)}`);
                }
            }
        }
        if (ctx.isDebugEnabled()) ctx.debug(`got default root '${bestValue}' with score of ${bestScore} for line ${this.idx}: ${JSON.stringify(bestChar.rect)}`);
        return [bestChar.rect];
    }

    private buildChars(): Char[] {
        const ctx = this.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`buildChars enter - line=${this.idx}, numContours=${this.contours.length}`);
        // Sort contours left-to-right
        this.contours.sort((a, b) => a.rect.x - b.rect.x);
        let chars: Char[] = [];
        const iter = new CharIterator(this, this.cfg);
        for (; ;) {
            const c = iter.nextChar();
            if (!c) break;
            chars.push(c);
        }
        chars = this.setTypes(chars);
        if (ctx.isDebugEnabled()) ctx.debug(`buildChars exit - line=${this.idx}`);
        return chars;
    }

    private setTypes(chars: Char[]): Char[] {
        const ctx = this.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`setTypes enter: line=${this.idx}, numChars=${chars.length}`);
        if (chars.length === 0) return chars;
        const roots = this.roots || this.getDefaultRoots(chars);
        ctx.trace(`chars.length} total characters`);
        // Set type 1 element types
        ctx.trace(`initializing type 1 characters`);
        for (let i = 0; i < chars.length; i++) {
            const c = chars[i] as Char;
            for (let j = 0; j < roots.length; j++) {
                if (Util.rectContains(roots[j] as cv.Rect, c.rect)) {
                    c.setType(1);
                    break;
                }
            }
        }
        // Set type 2 element types (left-to-right, then right-to-left)
        let lc: Char | undefined;
        if (ctx.isVerboseEnabled()) ctx.verbose(`initializing type 2 characters: left-to-right`);
        for (let i = 0; i < chars.length; i++) {
            const c = chars[i] as Char;
            if (c.getType() > 2) {
                if (lc && lc.contains(c, true)) c.setType(2);
            }
            if (c.getType() <= 2 && (!lc || !Util.xIntersects(c.rect, lc.rect))) lc = c;
        }
        lc = undefined;
        if (ctx.isVerboseEnabled()) ctx.verbose(`initializing type 2 characters: right-to-left`);
        for (let i = chars.length - 1; i >= 0; i--) {
            const c = chars[i] as Char;
            if (c.getType() > 2) {
                if (lc && lc.contains(c, false)) c.setType(2);
            }
            if (c.getType() <= 2 && (!lc || !Util.xIntersects(c.rect, lc.rect))) lc = c;
        }
        // Adjust the rect values of all other types
        lc = undefined;
        if (ctx.isVerboseEnabled()) ctx.verbose(`adjusting rect values: left-to-right`);
        for (let i = 0; i < chars.length; i++) {
            const c = chars[i] as Char;
            if (c.getType() > 3) {
                if (lc) c.adjust(lc.rect);
            } else {
                lc = c;
            }
        }
        lc = undefined;
        if (ctx.isVerboseEnabled()) ctx.verbose(`adjusting rect values: right-to-left`);
        for (let i = chars.length - 1; i >= 0; i--) {
            const c = chars[i] as Char;
            if (c.getType() > 3) {
                if (lc) c.adjust(lc.rect);
            } else {
                lc = c;
            }
        }
        // Resort left-to-right since the X values may have changed
        if (ctx.isVerboseEnabled()) ctx.verbose(`re-sorting: left-to-right`);
        chars.sort((a, b) => a.rect.x - b.rect.x);
        for (let i = 0; i < chars.length; i++) {
            const c = chars[i] as Char;
            c.setIndex(i);
        }
        // Set type 3 element types (left-to-right, then right-to-left)
        lc = undefined;
        if (ctx.isVerboseEnabled()) ctx.verbose(`initializing type 3 characters left-to-right`);
        for (let i = 0; i < chars.length; i++) {
            const c = chars[i] as Char;
            if (c.getType() > 3) {
                if (lc && lc.isNear(c, true)) {
                    c.setType(3, lc);
                }
            }
            if (c.getType() <= 3) lc = c;
        }
        lc = undefined;
        if (ctx.isVerboseEnabled()) ctx.verbose(`initializing type 3 characters right-to-left`);
        for (let i = chars.length - 1; i >= 0; i--) {
            const c = chars[i] as Char;
            if (c.getType() > 3) {
                if (lc && lc.isNear(c, false)) {
                    c.setType(3, lc);
                }
            }
            if (c.getType() <= 3) lc = c;
        }
        // Delete remaining type 4 characters
        if (ctx.isVerboseEnabled()) ctx.verbose(`dropping type 4 characters`);
        chars = chars.filter(c => {
            const keep = c.getType() <= 3;
            if (!keep) if (ctx.isDebugEnabled()) ctx.debug(`dropping character ${c.idx}`);
            return keep;
        });
        if (ctx.isDebugEnabled()) ctx.debug(`setTypes exit: numChars=${chars.length}`);
        return chars;
    }

    private buildBoundingRect(): cv.Rect {
        const ctx = this.ctx;
        if (ctx.isDebugEnabled()) ctx.debug(`buildBoundingRect enter: line=${this.idx}`);
        const chars = this.getChars();
        const mat = this.image.mat;
        let size = mat.size();
        let minX = mat.cols;
        let minY = mat.rows;
        let maxX = 0;
        let maxY = 0;
        for (let i = 0; i < chars.length; i++) {
            const c = chars[i] as Char;
            const type = c.getType();
            if (ctx.isVerboseEnabled()) ctx.verbose(`character ${i} is type ${type}: ${JSON.stringify(c.rect)}`);
            if (type >= 4) continue;
            const x1 = c.rect.x;
            const x2 = c.rect.x + c.rect.width;
            minX = Math.min(minX, x1);
            if (x2 > maxX) {
                maxX = x2;
                if (ctx.isDebugEnabled()) ctx.debug(`character ${i} increased maxX to ${maxX}: ${JSON.stringify(c.rect)}`);
            }
            if (type > 2) continue;
            const y1 = c.rect.y;
            const y2 = c.rect.y + c.rect.height;
            minY = Math.min(minY, y1);
            maxY = Math.max(maxY, y2);
        }
        const lPad = 5;
        const rPad = 5;
        const tPad = 0;
        const bPad = 0;
        const X = Math.max(0, minX - lPad);
        const Y = Math.max(0, minY - tPad);
        const W = Math.min(size.width - X, maxX - minX + lPad + rPad);
        const H = Math.min(size.height - Y, maxY - minY + tPad + bPad);
        if (W <= 0 || H <= 0) {
            if (ctx.isDebugEnabled()) ctx.debug(`line: no line elements found; W=${W}, H=${H}, size=${JSON.stringify(size)}, minX=${minX}, maxX=${maxX}, minY=${minY}, maxY=${maxY}`);
            const rects = this.contours.map(c => c.rect);
            return Util.getBoundingRectOfRects(rects);
        }
        const rect = new cv.Rect(X, Y, W, H);
        if (ctx.isDebugEnabled()) ctx.debug(`buildBoundingRect exit: line=${this.idx}, rect=${JSON.stringify(rect)}`);
        return rect;
    }

    public yIntersectsContour(contour: Contour): boolean {
        if (!this.yRange) throw new Error(`line ${this.idx} has no contours`);
        return Util.minMaxIntersects(this.yRange, contour.getYRange());
    }

    /*
     * Calculate the fitness factor as a value from [0,1], the higher the better.
     * It is calculated as a multiple of the nearness to the last contour of the line
     * and the fraction that it intersects on the Y-axis.
     */
    public getFitnessFactor(contour: Contour): number {
        const ctx = this.ctx;
        if (!this.yRange) throw new Error(`line ${this.idx} has no contours`);
        const lc = this.lastContour();
        const curRect = contour.rect;
        const lastRect = lc.rect;
        const dist = Util.xDistance(curRect, lastRect);
        const maxDist = this.cfg.maxSpaceBetweenWords;
        const xNearnessFactor = dist >= maxDist ? 0 : (maxDist - dist) / maxDist;
        const yIntersectFactor = Util.fractionIntersects(this.yRange, contour.getYRange());
        const fitnessFactor = xNearnessFactor * yIntersectFactor;
        if (ctx.isDebugEnabled()) ctx.debug(`getFitnessFactor of contour ${contour.idx} to last contour ${lc.idx} of line ${this.count}: fitness=${fitnessFactor}, nearness=${xNearnessFactor}, intersects=${yIntersectFactor}, dist=${dist}, curRect=${JSON.stringify(curRect)}, lastRect=${JSON.stringify(lastRect)}`)
        return fitnessFactor;
    }

    public yContainsContour(contour: Contour, pad?: number): boolean {
        if (!this.yRange) throw new Error(`line ${this.idx} has no contours`);
        pad = pad || 0;
        if (this.yRange.min - pad > contour.rect.y) return false;
        if (this.yRange.max + pad < contour.rect.y + contour.rect.height) return false;
        return true;
    }

    public findNearest(c: Contour): Contour | undefined {
        const X = c.rect.x;
        let nearest: Contour | undefined;
        let distance: number = this.cfg.maxSpaceBetweenWords;
        for (const contour of this.contours) {
            if (!c.yIntersects(contour)) continue;
            const d = Math.abs(contour.rect.x - X);
            if (d < distance) {
                nearest = contour;
            }
        }
        return nearest;
    }

    public firstContour(): Contour {
        if (this.isEmpty()) throw Error(`line is empty`);
        return this.contours[0] as Contour;
    }

    public lastContour(count?: number): Contour {
        if (this.isEmpty()) throw Error(`line is empty`);
        count = count || 1;
        return this.contours[this.contours.length - count] as Contour;
    }

    public xDistancePast(contour: Contour): number {
        const prev = this.lastContour();
        return contour.rect.x - (prev.rect.x + prev.rect.width);
    }

    public isEmpty(): boolean {
        return this.contours.length === 0;
    }

    public performOverlapCorrection() {
        const ctx = this.ctx;
        const pad = this.image.ocr.cfg.overlapPadding;
        ctx.debug(`begin overlap correction for line ${this.idx} (pad=${pad})`);
        const img = this.image.roi("micr-line-overlap", Util.enlargeRect(this.getBoundingRect(), this.image.size(), {pad}));
        const contours = img.getContours();
        if (ctx.debugImages) img.drawContours({contours});
        // Per contour overlap correction, for those that touch the top border
        for (const c of contours) {
            if (c.rect.y == 0) Curves.clear(img, (p: IPoint) => p.y < pad, {rect: c.rect});
        }
        if (ctx.debugImages) img.display("micr-line-curve-cleared");
        // Clear padding next in order to make HV thinning more productive
        img.clearPadding(pad);
        if (ctx.debugImages) img.display("micr-line-padding-cleared");
        // Clear by horizontal and vertical counts
        for (const c of contours) {
            if (c.rect.y == 0) {
                img.clearByVerticalThickness(this.verticalThicknessThreshold, {rect: c.rect});
                img.hvThin(this.minHorizontalCount,this.minVerticalCount,c.rect);
            }
        }
        if (ctx.debugImages) img.display("micr-line-hv-cleared");
        this.image = img;
        ctx.debug(`end overlap correction for line ${this.idx}`);
    }

    public display(opts?: { name?: string }) {
        const ctx = this.ctx;
        opts = opts || {};
        const name = opts.name || `line-${this.idx}`;
        const img = this.image.rgb();
        const tpad = 1;
        const bpad = 100;
        const lpad = 1;
        const rpad = 1;
        const newMat = img.newCustomMat(img.mat.cols + lpad + rpad, img.mat.rows + tpad + bpad, cv.CV_8UC3);
        cv.copyMakeBorder(img.mat, newMat, tpad, bpad, lpad, rpad, cv.BORDER_CONSTANT, Color.white);
        const minLabelY = newMat.size().height - 80;
        const maxLabelY = newMat.size().height - 10;
        let labelY = minLabelY;
        const chars = this.getChars();
        for (const char of chars) {
            const type = char.getType();
            if (ctx.isDebugEnabled()) ctx.debug(`character ${char.idx} has type ${type}`)
            let color: cv.Scalar | undefined;
            if (type === 1) color = Color.lightBlue;
            else if (type === 2) color = Color.green;
            else if (type === 3) color = Color.white;
            else color = Color.red;
            // Draw the character rectangle
            Util.drawRect(newMat, char.rect, color, 1, 0);
            // Draw the character number
            const area = char.rect.height * char.rect.width;
            const labelPt = img.newPoint(char.rect.x, labelY);
            cv.putText(newMat, `${char.idx}:${area}`, labelPt, cv.FONT_HERSHEY_PLAIN, 1, color, 1);
            labelY += 12;
            if (labelY > maxLabelY) labelY = minLabelY;
        }
        const image = new Image(name, newMat, this.ocr, ctx);
        image.display();
    }

    public toImage(opts?: { name?: string }): Image {
        opts = opts || {};
        const name = opts.name || `line-${this.idx}`;
        const rect = this.getBoundingRect();
        const img = this.image.roi(name, rect);
        return img;
    }

    public toJSON() {
        const rtn: any = { count: this.count };
        if (this.idx >= 0) rtn.idx = this.idx;
        if (this.yRange) {
            rtn.minY = this.yRange.min;
            rtn.maxY = this.yRange.max;
        }
        return rtn;
    }

}

class CharIterator {

    public readonly line: Line;
    public readonly cfg: Config;
    public readonly ctx: Context;
    public contourIdx = 0;
    public charIdx = 0;

    private prevChar: Char | undefined;
    private nextSingleContourChar: Char | undefined;
    private maxWidth = 0;
    private avgWidth: number;
    private minDistBetween: number;
    private maxDistBetween: number;
    private avgDistBetween: number;
    private charStack: Char[] = [];

    public constructor(line: Line, cfg: Config) {
        this.line = line;
        this.ctx = line.ctx;
        this.cfg = cfg;
        let widthTotal = 0;
        let widthCount = 0;
        let distBetweenTotal = 0;
        let distBetweenCount = 0;
        this.minDistBetween = Number.MAX_VALUE;
        this.maxDistBetween = 0;
        let pc: Contour | undefined;
        for (const c of this.line.contours) {
            // For medium contours (no overlap) that are big enough to be a character by themselves
            if (c.isMedium()) {
                // Calculate max and average width
                this.maxWidth = Math.max(c.width, this.maxWidth);
                widthTotal += c.width;
                widthCount++;
                if (pc) {
                    const distBetween = Util.xDistance(pc.rect, c.rect);
                    if (distBetween <= this.cfg.maxSpaceBetweenCharsOfWord) {
                        this.minDistBetween = Math.min(distBetween, this.minDistBetween);
                        this.maxDistBetween = Math.max(distBetween, this.maxDistBetween);
                        distBetweenTotal += distBetween;
                        distBetweenCount++;
                    }
                }
                pc = c;
            } else {
                pc = undefined;
            }
        }
        this.avgWidth = Math.round(widthTotal / widthCount);
        this.avgDistBetween = Math.round(distBetweenTotal / distBetweenCount);
        this.ctx.trace(`CharIterator: maxWidth=${this.maxWidth}, avgWidth=${this.avgWidth}, avgDistBetween=${this.avgDistBetween}, minDistBetween=${this.minDistBetween}, maxDistBetween=${this.maxDistBetween}`);
    }

    /**
     * Get the next character which may contain more than one contour
     */
    public nextChar(): Char | undefined {
        const ctx = this.ctx;
        ctx.trace(`nextChar enter: contourIdx=${this.contourIdx}`);
        if (this.charStack.length == 0) {
            let buf: Contour[] = [];       // buffer of special contours which are combined to form a single character
            for (; ;) {
                const c = this.nextContour();
                if (!c) break;
                if (c.isMedium()) {
                    // This contour is large enough to be a character by itself
                    this.nextSingleContourChar = new Char(-1, [c], Util.rectClone(c.rect), this.line);
                    this.charStack.push(this.nextSingleContourChar);
                    break;
                }
                buf.push(c);
            }
            if (buf.length > 0) {
                const used: Contour[] = [];
                if (this.prevChar) {
                    let neighbor = this.prevChar;
                    // Search to the right of the previous character
                    ctx.trace(`nextChar: searching to right of previous character`);
                    for (; ;) {
                        const ch = this.groupContours(neighbor, true, buf, used);
                        if (!ch) break;
                        this.charStack.push(ch);
                        neighbor = ch;
                    }
                }
                if (this.nextSingleContourChar) {
                    let neighbor = this.nextSingleContourChar;
                    // Search to the left of the next character
                    ctx.trace(`nextChar: searching to left of next character`);
                    for (; ;) {
                        const ch = this.groupContours(neighbor, false, buf, used);
                        if (!ch) break;
                        this.charStack.push(ch);
                        neighbor = ch;
                    }
                }
                for (const c of buf) {
                    if (!c.isMemberOf(used)) {
                        ctx.trace(`nextChar: dropped contour ${c.idx}`);
                    }
                }
            }
            this.charStack.sort((a: Char, b: Char) => a.rect.x - b.rect.x);
        }
        if (this.charStack.length > 0) {
            const rtn = this.charStack.shift();
            if (rtn) {
                if (rtn === this.nextSingleContourChar) {
                    this.nextSingleContourChar = undefined;
                }
                rtn.idx = this.charIdx;
                const contourIndices = rtn.contours.map((c) => c.idx);
                ctx.trace(`nextChar exit: returned char ${rtn.idx}, contours=${JSON.stringify(contourIndices)}, rect=${JSON.stringify(rtn.rect)}, large=${rtn.hasLargeContour}`);
                this.charIdx++;
            }
            this.prevChar = rtn;
            return rtn;
        }
        ctx.trace(`nextChar exit: none`);
        return undefined;
    }

    private groupContours(char: Char, right: boolean, ca: Contour[], used: Contour[]): Char | undefined {
        const ctx = this.ctx;
        // Get the projected rectangle to the right or left of 'char'
        const projected = this.getProjectedCharRect(char.rect, right);
        ctx.trace(`groupContours: enter, right=${right}, char=${JSON.stringify(char.rect)}, projected=${JSON.stringify(projected)}, numContours=${ca.length}`);
        const buf: Contour[] = [];
        // Add all contours that intersect with the projected rectangle to a buffer
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i] as Contour;
            if (c.isMemberOf(used)) {
                ctx.trace(`groupContours: contour ${c.idx} has already been used`);
                continue;
            }
            ctx.trace(`groupContours: checking contour ${c.idx}: ${JSON.stringify(c.rect)}`);
            const ic = Util.getIntersectingRect(c.rect, projected);
            if (!ic) {
                ctx.trace(`groupContours: contour ${c.idx} does not intersect projected`);
                continue;
            }
            if (c.isLarge()) {
                c = c.getSubContour(ic);
                ctx.trace(`groupContours: large contour ${c.idx}, subContour=${JSON.stringify(c.rect)}`);
            }
            ctx.trace(`groupContours: adding contour ${c.idx} to buffer`);
            buf.push(c);
        }
        // If contours in the buffer is large enough for a character,
        // remove them from the input 'ca' array and return the character
        if (buf.length > 0 && this.isLargeEnoughForChar(buf)) {
            for (const c of buf) used.push(c);
            const rect = this.getBoundingRect(buf);
            ctx.trace(`groupContours: exit, result=${JSON.stringify(rect)}`);
            return new Char(-1, buf, rect, this.line);
        }
        ctx.trace(`groupContours: exit, done`);
        return undefined;
    }

    private getProjectedCharRect(rect: cv.Rect, right: boolean): cv.Rect {
        const X = right ? rect.x + rect.width + this.minDistBetween : rect.x - this.maxDistBetween - this.maxWidth;
        const Y = rect.y;
        const W = right ? this.maxWidth : this.maxWidth + (this.maxDistBetween - this.minDistBetween);
        const H = rect.height;
        return new cv.Rect(X, Y, W, H);
    }

    private nextContour(): Contour | undefined {
        const ctx = this.ctx;
        const contours = this.line.contours;
        for (; ;) {
            const idx = this.contourIdx;
            if (idx >= contours.length) break;
            const contour = contours[idx] as Contour;
            this.contourIdx++;
            ctx.trace(`nextContour ${contour.idx}, size=${contour.size}: ${JSON.stringify(contour.rect)}`);
            return contour;
        }
        ctx.trace(`nextContour: none remaining`);
        return undefined;
    }

    private isLargeEnoughForChar(ca: Contour[]): boolean {
        const ctx = this.ctx;
        const caRect = this.getBoundingRect(ca);
        const area = caRect.height * caRect.width;
        const largeEnough = area > this.line.minCharArea;
        ctx.trace(`largeEnough=${largeEnough}, area=${area}, minCharArea=${this.line.minCharArea}`);
        return largeEnough;
    }

    private getBoundingRect(contours: Contour[]): cv.Rect {
        const rects = contours.map((e) => e.rect);
        return Util.getBoundingRectOfRects(rects);
    }

}
