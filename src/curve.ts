/**
 * Copyright (c) 2024 Capital One
*/
import { cv } from './ocv.js';
import { Color } from './color.js';
import { Image } from './image.js';
import { Context } from './context.js';
import { Util, MinMaxRect, IPoint } from './util.js';

export type InLearnRegionFcn = (p: IPoint) => boolean;

interface StartInfo {
    p1: IPoint;
    p2: IPoint;
    degree: number;
}

interface DrawOpts {
    image?: Image;
    color?: Color;
}

// TODO: Make the following configurable
const maxDelta = 20;
const goodSmallDelta = 15;
const maxStepsBack = 4;
const probeStartSteps = 2;
const maxForwardProbes = 20;
const maxEdgeProbeFactor = 1.1;

/**
 * A curve consists of two edges: edge1 and edge2.
 * Each edge consists of a sequence of edge points.
 * An edge point is a point which is set and which is adjacent to at least one unset point or is on the border of the region of the image being considered.
 * A degree is a value from 0 to 359 corresponding to the 360 degrees of a circle.
 * 0 degrees is right, 90 degrees is up, 180 degrees is left, and 270 degrees is down.
 * The degree of an edge point is computed for two or more edge points in order to keep track of the direction of the edge at any point.
 * The "otherEdgePoint" of an edge point EP is the closest point in the other edge to EP.
 * The width of a curve at any edge point is the distance between the edge point and it's otherEdgePoint.
 * The degreeDelta of an edge point is the difference between it's degree and the degree of it's otherEdgePoint.
 * The larger the degreeDelta is of an edge point, the more the two edges are going in different directions at those points.
 * 
 * 1) Following an edge 
 *    When we follow a curve, we bounce back and forth between edges so that we follow both edges of the curve relatively equally.
 *    As we go, we compute the degree of each edge point, which means we know the direction of an edge at any edge point.
 *    This helps us to find the next edge point. 
 * 
 *    NOTE: I tried using canny edge detection to make it easier to follow the edges.  However, I could not get canny to find all edges even after
 *    trying a lot of different values for upper and lower thresholds and for the sobel aperture size.  That said, my edge following logic seems
 *    to work well.
 * 
 * 2) Recognizing an intersection
 *    When the degreeDelta of any edge point is larger than "maxDelta", we know that we are at an intersection.
 * 
 *    NOTE: An increase in width could also be used for intersection recognition; however, using degreeDelta seems to work pretty well currently.
 *    That said, we would rather be too quick rather than too slow to recognize an intersection in order to prevent clearing part of the
 *    image which we should not; therefore, using a width increase (in addition to the degreeDelta) to trigger the beginning of an
 *    intersection may be useful.
 * 
 * 3) Crossing an intersection
 *    Crossing an intersection consists of finding the 2 edge points, 1 from each edge, and the degree/direction of each edge at which to continue
 *    following and clearing the curve.  This is the most difficult part to get right.  Again, we would rather fail to cross an intersection
 *    and therefore not clear part of the curve rather than incorrectly cross and then clear something that we should not.
 *    See the 'crossIntersection' function for the implementation.
 * 
 *    NOTE: I tried using skeletonization to make it easier to cross intersections.  However, I could not get my skeletonization implementation to
 *    result in minimal contiguous points such that each point (except the 1st and last) have exactly two neighbors, except for intersection points.
 *    I tried to implement the algorithm at https://github.com/LingDong-/skeleton-tracing/tree/master?tab=readme-ov-file#introduction
 *    which seems to be reported to return these minimal contiguous points, but I could not get it to work fully.
 *    See the getSkeletonFragments method in image.ts for my attempt.
 */
export class Curves {

    private static count = 0;

    public static clear(image: Image, ilrf: InLearnRegionFcn, opts?: { rect?: cv.Rect }) {
        const cc = new Curves(image, ilrf, opts);
        cc.clear();
    }

    private image: Image;
    private ilrf: InLearnRegionFcn;
    private rect: cv.Rect;
    private r: MinMaxRect;
    private ctx: Context;

    constructor(image: Image, ilrf: InLearnRegionFcn, opts?: { rect?: cv.Rect }) {
        opts = opts || {};
        this.image = image;
        this.ilrf = ilrf;
        this.rect = opts.rect || image.rect;
        this.r = Util.toMinMaxRect(this.rect);
        this.ctx = image.ctx;
        if (this.ctx.debugImages) {
            image.dumpBits(this.r);
            image.dumpRangeBits(this.r);
        }
    }

    public clear() {
        // Clear curves that touch the top border on Y axis and proceed in downward direction (270 degrees)
        this.clearByY("top", this.r.y.min, 270);
    }

    private clearByY(type: string, y: number, degree: number) {
        let x1: number | undefined;
        for (let x = this.r.x.min; x <= this.r.x.max; x++) {
            if (this.image.isSet(x, y)) {
                if (x1 == undefined) x1 = x;
            } else if (x1 !== undefined) {
                this.clearCurve(type, x1, x - 1, y, degree);
                x1 = undefined;
            }
        }
        if (x1) this.clearCurve(type, x1, this.r.x.max, y, degree);
    }

    private clearCurve(type: string, x1: number, x2: number, y: number, degree: number) {
        const ctx = this.image.ctx;
        const count = ++Curves.count;
        ctx.debug(`clearCurve begin - type=${type}, count=${count}, x1=${x1}, x2=${x2}, y=${y}`);
        const c = new Curve(`curve${count}-${type}`, this.image, this.r, this.ilrf);
        c.followAndClear({ p1: { x: x1, y }, p2: { x: x2, y }, degree });
        if (this.image.ctx.debugImages) this.image.display(`${c.name}-cleared`);
    }
    
}

export class Curve {

    public readonly name: string;
    public readonly image: Image;
    public readonly rect: MinMaxRect;
    public ctx: Context;
    public edge1: Edge;
    public edge2: Edge;
    public maxWidth?: number;
    public done = false;
    public ilrf: InLearnRegionFcn; 

    constructor(name: string, image: Image, rect: MinMaxRect, ilrf: InLearnRegionFcn) {
        this.name = name;
        this.image = image;
        this.rect = rect;
        this.ilrf = ilrf;
        this.ctx = image.ctx;
        this.edge1 = new Edge(`${name}-edge1`, this, false);
        this.edge2 = new Edge(`${name}-edge2`, this, true);
        this.edge1.other = this.edge2;
        this.edge2.other = this.edge1;
    }

    public followAndClear(sp: StartInfo | undefined) {
        const ctx = this.ctx;
        ctx.debug(`followAndClear ${this.name}: ${JSON.stringify(sp)}`);
        // We use the "below" neighbor because the overlap starts at the top and goes down "below"
        const n = Neighbor.getByName("below");
        while (sp) {
            // initialize both edges of curves
            this.edge1.points.length = 0;
            this.edge2.points.length = 0;
            this.edge1.addPoint(sp.p1, n);
            this.edge2.addPoint(sp.p2, n);
            // follow each edge of the curve until we hit what looks like an intersection
            this.follow();
            // try to cross an intersection and get new start points on the other edge
            sp = this.crossIntersection();
            // clear
            this.clear();
        }
    }

    public stop() {
        this.done = true;
    }

    // Follow until we reach an intersection
    private follow() {
        for (; ;) {
            // Bounce back-n-forth between edges so that we build out the points relatively equally
            if (!this.edge1.follow()) break;
            if (!this.edge2.follow()) break;
        }
    }

    public crossIntersection(): StartInfo | undefined {
        const ctx = this.ctx;
        // If marked done, don't try to cross
        if (this.done) {
            ctx.debug(`crossIntersection ${this.name}: done`);
            return undefined;
        }
        // 1. Search backwards on edge 1 for a max number of steps to find the smallest delta between the degrees of each edge
        //    If the delta is smaller than e are convinced we can compute the direction of the curve accurately enough.
        ctx.debug(`crossIntersection ${this.name}: search backwards from point ${this.edge1.points.length - 1}`);
        let steps = 0;
        let smallestDeltaPoint: Point | undefined;
        let smallestDelta: number | undefined;
        let smallestSteps = 0;
        for (let i = this.edge1.points.length - 1; i >= 0 && steps < maxStepsBack; i--, steps++) {
            const p = this.edge1.points[i] as Point;
            const d = p.getDegreeDelta();
            if (!d) continue;
            if (smallestDelta == undefined || d < smallestDelta) {
                smallestDeltaPoint = p;
                smallestDelta = d;
                smallestSteps = steps;
                if (d < goodSmallDelta) {
                    ctx.debug(`crossIntersection ${this.name}: found good small delta of ${d} at point ${p.idx}`);
                    break;
                } else {
                    ctx.debug(`crossIntersection ${this.name}: found smaller delta of ${d} at point ${p.idx}`);
                }
            }
        }
        if (!smallestDeltaPoint) {
            ctx.debug(`crossIntersection ${this.name}: did not find small degree delta`);
            return undefined;
        }
        // 2. Get the mid point between this point on edge 1 and the matching point on edge 2 and the average degree
        const otherPoint = smallestDeltaPoint.other();
        const midPoint = Util.midPoint(smallestDeltaPoint.x, smallestDeltaPoint.y, otherPoint.x, otherPoint.y);
        const d1 = smallestDeltaPoint.getDegree();
        if (!d1) {
            ctx.debug(`crossIntersection ${this.name}: no degree for small delta point`);
            return undefined;
        }
        const d2 = otherPoint.getDegree();
        if (!d2) {
            ctx.debug(`crossIntersection ${this.name}: no degree for other delta point`);
            return undefined;
        }
        const degree = Util.degreeAverage(d1, d2);
        const width = Util.distance(smallestDeltaPoint, otherPoint);
        ctx.debug(`crossIntersection ${this.name}: found mid point at ${JSON.stringify(midPoint)} with average degree of ${degree} and width ${width} (d1=${d1}, d2=${d2})`);
        // 3. Walk forward a little more than we walked backwards in step 1.  All points must be set.  This is called the startMidPoint.
        steps = smallestSteps + probeStartSteps;
        const lw = new DegreeWalker(midPoint, degree);
        let p: IPoint | undefined;
        for (let i = 0; i < steps; i++) {
            p = lw.next();
            const ps = this.image.isSet(p.x, p.y);
            if (!ps) {
                ctx.debug(`crossIntersection ${this.name}: failed to find probe start point; failed at step ${i} of ${steps} at point ${JSON.stringify(p)}`);
                return undefined;
            };
        }
        if (!p) throw new Error(`unexpected state`);
        ctx.debug(`crossIntersection ${this.name}: found start mid point at ${JSON.stringify(p)} after ${steps} steps forward`);
        // 4. For a max num iterations, walking forward by 1 at each iteration, probe to right and left for a little more than the
        //    curve width to find the first non-set pixels.  If the total distance between these points is similar width, then return
        //    this as the start of the next curve section.
        const rightDegree = Util.degreeRotate(degree, -90);
        const leftDegree = Util.degreeRotate(degree, 90);
        const maxEdgeProbes = Math.ceil(width * maxEdgeProbeFactor);
        for (let i = 0; i < maxForwardProbes; i++, p = lw.next()) {
            // probe to the right
            const p1 = this.edgeProbe("right", this.image, p, rightDegree, maxEdgeProbes);
            if (!p1) continue;
            // probe to the left
            const p2 = this.edgeProbe("left", this.image, p, leftDegree, maxEdgeProbes);
            if (!p2) continue;
            // If O: Compare the distance between p1 and p2 width to the previous width before crossing the intersection.  If the widths are not similar, stop following
            // in order to avoid removing too much.
            // const d = Util.distance(p1, p2);
            // We found the new points on the other edge of the intersection from which to begin following this next section of the curve.
            const si: StartInfo = { p1, p2, degree };
            ctx.debug(`crossIntersection ${this.name}: successfully crossed to ${JSON.stringify(si)}`);
            return si;
        }
        ctx.debug(`crossIntersection ${this.name}: failed to cross`);
        return undefined;
    }

    private edgeProbe(name: string, image: Image, sp: IPoint, degree: number, maxIter: number): IPoint | undefined {
        const ctx = this.ctx;
        const lw = new DegreeWalker(sp, degree);
        for (let i = 0, p = lw.next(); i < maxIter; i++, p = lw.next()) {
            if (!image.isSet(p.x, p.y)) {
                ctx.debug(`edgeProbe ${name}: found after ${i} iterations`);
                return p;
            }
        }
        ctx.debug(`edgeProbe ${name}: not found after ${maxIter} iterations`);
        return undefined;
    }

    // Clear 
    private clear() {
        let points: number[][] = [];
        for (let i = 0; i < this.edge1.points.length; i++) {
            const p = this.edge1.points[i] as Point;
            points.push([p.x, p.y]);
        }
        for (let i = this.edge2.points.length - 1; i >= 0; i--) {
            const p = this.edge2.points[i] as Point;
            points.push([p.x, p.y]);
        }
        this.image.clearByBoundary(points);
    }

    public draw(image: Image) {
        this.edge1.draw({ image, color: Color.red });
        this.edge2.draw({ image, color: Color.green });
    }

    public log() {
        this.ctx.debug(`BEGIN curve ${this.name}`);
        this.edge1.log();
        this.edge2.log();
        this.ctx.debug(`END curve ${this.name}`);
    }

    public toJSON(): Object {
        return {
            name: this.name,
            edge1: this.edge1,
            edge2: this.edge2,
        };
    }

}

class Edge {

    public readonly name: string;
    public readonly curve: Curve;
    public readonly clockwise: boolean;
    public readonly points: Point[] = [];
    public readonly ctx: Context;

    public other?: Edge;

    constructor(name: string, curve: Curve, clockwise: boolean) {
        this.name = name;
        this.curve = curve;
        this.clockwise = clockwise;
        this.ctx = curve.ctx;
    }

    public init(p: cv.Point, n: Neighbor) {
        this.points.length = 0;
        this.addPoint(p, n);
    }

    public addPoint(p: cv.Point, n: Neighbor) {
        this.addPoint2(new Point(p.x, p.y, this, n));
    }

    public addPoint2(p: Point) {
        p.idx = this.points.length;
        this.points.push(p);
        this.ctx.debug(`added point ${this.points.length} to ${this.name}: ${JSON.stringify(p)}`);
    }

    // Follow the points along this edge
    public follow(): boolean {
        this.ctx.debug(`follow ${this.name}: enter`)
        let curPoint = this.lastPoint();
        let nextPoint: Point | undefined;
        for (; ;) {
            nextPoint = curPoint.nextEdgePoint();
            // If no next point is found, stop following
            if (!nextPoint) {
                this.ctx.debug(`follow ${this.name}: complete (no more points)`)
                this.curve.stop();
                return false;
            }
            // If the other edge already contains this point, stop following
            const os = this.otherEdge();
            if (os.contains(nextPoint.x, nextPoint.y)) {
                this.ctx.debug(`follow ${this.name}: two edges meet`)
                this.curve.stop();
                return false;
            }
            // If the current point isn't in the learn region of the image and the degree delta exceeds some threshold,
            // we have finished following this part of the curve
            if (!this.curve.ilrf(nextPoint)) {
                // If an abrupt change in direction, try to cross the intersection
                const dd = curPoint.getDegreeDelta();
                if (dd && dd > maxDelta) {
                    this.ctx.debug(`follow ${this.name}: change in degree: ${dd}`);
                    return false;
                } else {
                    this.ctx.debug(`follow ${this.name}: deltaDegree = ${dd}`);
                }
            }
            this.addPoint2(nextPoint);
            // If this new point is further to the last point of the other edge than
            // the previous, return true which causes the other edge to follow
            const curDist = this.distanceToOtherEdge(curPoint);
            const nextDist = this.distanceToOtherEdge(nextPoint);
            if (nextDist > curDist) {
                this.ctx.debug(`follow ${this.name}: pause`)
                return true;
            }
            // Keep following on this edge
            curPoint = nextPoint;
        }
    }

    public draw(opts?: DrawOpts) {
        for (const p of this.points) {
            p.draw(opts);
        }
    }

    public log() {
        this.ctx.debug(`BEGIN edge ${this.name}`);
        for (const p of this.points) {
            p.log();
        }
        this.ctx.debug(`END edge ${this.name}`);
    }

    public otherEdge(): Edge {
        if (!this.other) {
            if (this === this.curve.edge1) {
                this.other = this.curve.edge2;
            } else {
                this.other = this.curve.edge1;
            }
        }
        return this.other as Edge;
    }

    public lastPoint(): Point {
        if (this.points.length === 0) throw new Error("no points");
        return this.points[this.points.length - 1] as Point;
    }

    public contains(x: number, y: number): boolean {
        for (const p2 of this.points) {
            if (p2.x == x && p2.y == y) return true;
        }
        return false;
    }

    // Return the distance between point 'p' (from this edge) to the last point of the other edge.
    public distanceToOtherEdge(p: Point): number {
        const p2 = this.otherEdge().lastPoint();
        const dist = Util.distance(p, p2);
        if (p.width < 0 || dist < p.width) {
            p.width = dist;
            p.nearestOther = p2;
            this.ctx.debug(`distanceToOtherEdge: from ${p.x}:${p.y} to ${p2.x}:${p2.y} is ${dist}`);
        }
        if (p2.width < 0 || dist < p2.width) {
            p2.width = dist;
            p2.nearestOther = p;
        }
        return dist;
    }

}

class Point {

    public x: number;
    public y: number;
    public edge: Edge;
    public n: Neighbor;
    public isSet: boolean;
    public idx?: number;
    public nearestOther?: Point;
    public width = -1;  // width of the curve at this point
    public ctx: Context;

    constructor(x: number, y: number, edge: Edge, n: Neighbor) {
        this.x = x;
        this.y = y;
        this.edge = edge;
        this.n = n;
        this.isSet = Util.inRect(x, y, edge.curve.rect) && edge.curve.image.isSet(x, y);
        this.ctx = this.edge.ctx;
    }

    // Find the next edge point
    public nextEdgePoint(): Point | undefined {
        const cw = this.edge.clockwise;
        const from = this.n.opposite();
        // Visit neighbors clockwise or counterclockwise, depending on which edge we are following.
        // When we find the first point that is set, that is the edge point.
        for (let n = from.nextByDir(cw); n != from; n = n.nextByDir(cw)) {
            const p = this.getNeighborPoint(n);
            if (p && p.isSet) return p;
        }
        return undefined;
    }

    public getNeighborPoint(n: Neighbor): Point | undefined {
        const x = this.x + n.x;
        const y = this.y + n.y;
        const curve = this.edge.curve;
        if (Util.inRect(x, y, curve.rect)) return new Point(x, y, this.edge, n);
        return undefined;
    }

    public prev(opts?: { err?: boolean }): Point {
        opts = opts || {};
        const err = opts.err || false;
        const idx = this.idx as number;
        if (idx == 0) {
            if (err) throw new Error(`No previous point`);
            return this;
        }
        return this.edge.points[idx - 1] as Point;
    }

    public getWidth(): number | undefined {
        const other = this.nearestOther;
        if (!other) return undefined;
        return Util.distance(this, other);
    }

    // Get the degree of this point.
    // 'before' is the number of points before this one to include.
    // 'after' is the number of points after this one to include.
    public getDegree(opts?: { before?: number, after?: number }): number | undefined {
        const ctx = this.ctx;
        const idx = this.idx;
        if (idx === undefined) throw new Error("no index");
        let points = this.edge.points;
        if (points.length < 2) {
            if (ctx.isDebugEnabled()) ctx.debug(`getDegree for point ${idx} of ${this.edge.name}: unknown (numPoints=${points.length})`);
            return undefined;  // Atleast 2 points are required to calculate degrees
        }
        opts = opts || {};
        const before = opts.before || 1;
        const after = opts.after || 3;
        const start = Math.max(idx - before, 0);
        const end = Math.min(idx + after + 1, points.length);
        points = points.slice(start, end);
        const degree = Util.getDegree(points);
        if (ctx.isDebugEnabled()) ctx.debug(`getDegree for point ${idx} of ${this.edge.name}: ${degree}`);
        return degree;
    }

    public getDegreeDelta(): number | undefined {
        const myDegree = this.getDegree();
        if (!myDegree) return undefined;
        const otherDegree = this.other().getDegree();
        if (!otherDegree) return undefined;
        return Util.degreeDelta(myDegree, otherDegree);
    }

    public other(): Point {
        if (this.nearestOther) return this.nearestOther;
        throw new Error(`No nearest other point found for ${this.idx} of ${this.edge.name}`);
    }

    public draw(opts?: DrawOpts) {
        opts = opts || {};
        const image = opts.image || this.edge.curve.image;
        image.drawPoint(this.x, this.y, { color: opts.color });
    }

    public log() {
        const other = this.nearestOther ? `${this.nearestOther.x}:${this.nearestOther.y}` : "";
        this.ctx.debug(`point (${this.x}:${this.y}), width=${this.width}, other=(${other})`);
    }

    public equals(p: Point): boolean {
        return p.x === this.x && p.y === this.y;
    }

    public toJSON(): Object {
        return { idx: this.idx, x: this.x, y: this.y, width: this.getWidth(), degree: this.getDegree() };
    }

}

export class DegreeWalker {

    private start: IPoint;
    private end: IPoint;
    
    private degree: number;
    private neighbors: Neighbor[];

    constructor(start: IPoint, degree: number) {
        this.start = start;
        this.end = start;
        this.degree = degree;
        this.neighbors = Neighbor.getSurroundingByDegree(degree);
    }

    public next(): IPoint {
        let bestPoint: IPoint | undefined;
        let leastDelta: number | undefined;
        for (let n of this.neighbors) {
            const p = n.getPoint(this.end);
            const d = Util.getDegree([this.start,p]);
            const dd = Util.degreeDelta(d, this.degree);
            if (!bestPoint || dd < (leastDelta as number)) {
                bestPoint = p;
                leastDelta = dd;
            }
        }
        if (!bestPoint) throw new Error(`no best point`);
        return bestPoint;
    }

}

class Neighbor {

    public static getByName(name: string): Neighbor {
        for (let n of Neighbor.all) {
            if (n.name == name) return n
        }
        throw new Error(`'${name}' is an invalid neighbor name; expecting one of ${Neighbor.all.filter(n => n.name)}`);
    }

    public static getByIndex(idx: number): Neighbor {
        const list = Neighbor.all;
        if (idx < 0 || idx >= list.length) throw new Error(`'${idx}' is an invalid neighbor index; expecting value in range [0,${list.length - 1}]`);
        return list[idx] as Neighbor;
    }

    public static getNearestByDegree(degree: number): Neighbor {
        const normal = Util.degreeNormalize(degree);
        let idx = Math.round(normal / 45);
        if (idx >= this.all.length) idx = 0;
        const rtn = this.all[idx];
        if (!rtn) throw new Error(`failed to find neighbor for ${degree} (normal=${normal}, idx=${idx})`);
        return rtn;
    }

    public static getSurroundingByDegree(degree: number): Neighbor[] {
        const nearest = this.getNearestByDegree(degree);
        const rtn = [nearest];
        if (nearest.degree < degree) {
            rtn.push(this.getByIndex((nearest.idx == Neighbor.all.length - 1 ? 0 : nearest.idx + 1)));
        } else if (nearest.degree > degree) {
            rtn.push(this.getByIndex((nearest.idx == 0 ? Neighbor.all.length - 1 : nearest.idx - 1)));
        }
        return rtn;
    }

    private static readonly all: Neighbor[] = [];
    static {
        Neighbor.add("right", 1, 0, 0);
        Neighbor.add("above-right", 1, -1, 45);
        Neighbor.add("above", 0, -1, 90);
        Neighbor.add("above-left", -1, -1, 135);
        Neighbor.add("left", -1, 0, 180);
        Neighbor.add("below-left", -1, 1, 225);
        Neighbor.add("below", 0, 1, 270);
        Neighbor.add("below-right", 1, 1, 315);
    }

    private static add(name: string, x: number, y: number, degree: number) {
        this.all.push(new Neighbor(name, this.all.length, x, y, degree));
    }

    public readonly name: string;
    public readonly idx: number;
    public readonly x: number;
    public readonly y: number;
    public readonly degree: number;

    constructor(name: string, idx: number, x: number, y: number, degree: number) {
        this.name = name;
        this.idx = idx;
        this.x = x;
        this.y = y;
        this.degree = degree;
    }

    public getPoint(p: IPoint) {
        return { x: p.x + this.x, y: p.y + this.y };
    }

    public next(): Neighbor {
        const list = Neighbor.all;
        if (this.idx == list.length - 1) return list[0] as Neighbor;
        return list[this.idx + 1] as Neighbor;
    }

    public prev(): Neighbor {
        const list = Neighbor.all;
        if (this.idx == 0) return list[list.length - 1] as Neighbor;
        return list[this.idx - 1] as Neighbor;
    }

    public nextByDir(clockwise: boolean): Neighbor {
        if (clockwise) return this.prev();
        else return this.next();
    }

    public opposite(): Neighbor {
        const count = Neighbor.all.length;
        const idx = (this.idx + (count/2)) % count;
        return Neighbor.getByIndex(idx);
    }

}
