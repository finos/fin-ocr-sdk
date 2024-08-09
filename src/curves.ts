/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { cv } from './ocv.js';
import { Color } from './color.js';
import { Contour } from './contour.js';
import { Image } from './image.js';
import { Context } from './context.js';
import { Util, MinMaxRect } from './util.js';

export class Curves {

    public static clear(contour: Contour) {
        const curves = new Curves(contour);
        curves.clear();
    }

    private image: Image;
    private rect: cv.Rect;
    private mmRect: MinMaxRect;
    private curves: Curve[] = [];
    private ctx: Context;

    constructor(contour: Contour) {
        this.image = contour.image;
        this.rect = contour.rect;
        this.mmRect = Util.toMinMaxRect(contour.rect);
        this.ctx = contour.ctx;
    }

    public clear() {
        const r = this.mmRect;
        this.image.dumpBits(r);
        this.image.dumpRangeBits(r);
        const points: cv.Point[] = [];
        for (let y = r.y.min; y <= r.y.max; y++) {
            for (let x = r.x.min; x <= r.x.max; x++) {
                if (this.isEdgePoint(x, y)) {
                    points.push(new cv.Point(x,y))
                }
            }
        }
    }

    private addPoints(p1: Point, p2: Point) {
        for (const c of this.curves) {
            if (c.addPoints(p1, p2)) return;
        }

    }

    private isEdgePoint(x: number, y: number): boolean {
        return this.image.isSet(x, y) && this.hasNonSetNeighbor(x, y);
    }

    private hasNonSetNeighbor(x: number, y: number): boolean {
        const r = this.mmRect;
        for (const n of neighborInfo) {
            const nx = x + n.x;
            const ny = y + n.y;
            if (Util.inRect(nx, ny, r) && !this.image.isSet(nx, ny)) return true;
        }
        return false;
    }

}

export class Curve {

    private edge1: Edge;
    private edge2: Edge;

    public constructor(p1: Point, p2: Point) {
        this.edge1 = new Edge(1, p1);
        this.edge2 = new Edge(1, p2);
    }

    public addPoints(p1: Point, p2: Point): boolean {
        if (this.edge1.addPoint(p1)) {
            if (!this.edge2.addPoint(p2)) throw new Error(`Unable to add point ${JSON.stringify(p2)} to edge ${JSON.stringify(this.edge2)}`);
        }
        return false;
    }

}

export class Edge {

    private id: number;
    private points: Point[] = [];

    constructor(id: number, p: Point) {
        this.id = id;
        this.points.push(p);
    }

    public addPoint(p: Point): boolean {
        if (p.isAdjacent(this.lastPoint())) {
            this.points.push(p);
            return true;
        }
        return false;
    }

    public lastPoint(): Point {
        if (this.points.length == 0) throw new Error("no points in edge");
        const last = this.points[this.points.length-1] as Point;
        return last;
    }

}

export class Point {

    public x: number;
    public y: number;
    public edge: Edge;

    constructor(x: number, y: number, edge: Edge) {
        this.x = x;
        this.y = y;
        this.edge = edge;
    }

    public isAdjacent(p: Point): boolean {
        const xDiff = Math.abs(this.x-p.x);
        const yDiff = Math.abs(this.y-p.y);
        return xDiff <= 1 && yDiff <= 1;
    }

}

interface Neighbor {
    x: number;
    y: number;
    name: string;
}

// Values to add to X and Y values in order to visit neighbors of a point
const neighborInfo: Neighbor[] = [
    { x: 0, y: -1, name: "above" },
    { x: 1, y: 0, name: "right" },
    { x: 0, y: 1, name: "below" },
    { x: -1, y: 0, name: "left" },
];
/*
const neighborInfo: Neighbor[] = [
    { x: 0, y: -1, name: "above" },
    { x: 1, y: -1, name: "above-right" },
    { x: 1, y: 0, name: "right" },
    { x: 1, y: 1, name: "below-right" },
    { x: 0, y: 1, name: "below" },
    { x: -1, y: 1, name: "below-left" },
    { x: -1, y: 0, name: "left" },
    { x: -1, y: -1, name: "above-left" },
];
*/
