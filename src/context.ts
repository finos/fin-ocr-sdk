/**
 * Copyright (c) 2024 Capital One
*/
import { cv } from "./ocv.js";
import { Config } from "./config.js";
import { Image, Images } from "./image.js";
import { Log } from "./log.js";
import { Util } from "./util.js";

export interface Deletable {
    delete: () => void;
}

let counter = 0;

/**
 * A Context object is used to manage a collection of related work.
 **/
export class Context extends Log {

    public static obtain(id?: string, config?: Config): Context {
        id = id || Util.randString(7);
        return new Context(id, config);
    }

    public readonly images = new Images();
    public debugImages = false;
    public deletables: Deletable[] = [];
    public slowRequestMs?: number;
    public hungRequestMs?: number;
    private startTime: number = 0;
    private finished = false;
    private count = ++counter;

    private constructor(id: string, config?: Config) {
        super(id, config ? config.logLevel : "info");
        const self = this;
        if (config) {
            this.slowRequestMs = config.slowRequestMs;
            this.hungRequestMs = config.hungRequestMs;
            if (this.slowRequestMs !== 0 || this.hungRequestMs !== 0) {
                this.startTime = Date.now();
                this.setBufferLogLevel(config.slowOrHungRequestLogLevel);
                if (this.hungRequestMs !== 0) {
                    const cb = function() {
                        self.hungRequestCallback();
                    };
                    setTimeout(cb, this.hungRequestMs);
                }
            }
        }
    }

    public release() {
        this.clear();
        if (this.slowRequestMs !== undefined && this.slowRequestMs !== 0) {
            const elapsed = Date.now() - this.startTime;
            if (elapsed > this.slowRequestMs) {
                this.flushBuffer(`Slow request was detected (${elapsed} ms)`);
            }
        }
        this.finished = true;
    }

    public addDeletable(deletable: Deletable) {
        this.deletables.push(deletable);
    }

    public newMat(): cv.Mat {
        const mat = new cv.Mat();
        this.addDeletable(mat);
        return mat;
    }

    public newMatVector(): cv.MatVector {
        const vector = new cv.MatVector();
        this.addDeletable(vector);
        return vector;
    }

    public cloneMat(mat: cv.Mat): cv.Mat {
        mat = mat.clone();
        this.addDeletable(mat);
        return mat;
    }

    public newCustomMat(height: number, width: number, type: number): cv.Mat {
        const mat = new cv.Mat(height, width, type);
        this.addDeletable(mat);
        return mat;
    }

    public removeDeletable(deletable: Deletable) {
        const idx = this.deletables.indexOf(deletable);
        if (idx > 0) {
            this.deletables = this.deletables.splice(idx,1);;
            if (this.isDebugEnabled()) this.debug(`removeDeletable ${idx}`);
        } else {
            this.warn(`removeDeletable element not found`);
        }
    }

    public addImage(image: Image, name?: string) {
        this.images.add(image.clone(name));
    }

    private clear() {
        const count = this.deletables.length;
        for (;;) {
            const d = this.deletables.pop();
            if (!d) break;
            try {
                d.delete();
            } catch (e) {
                this.warn("failed to delete", e);
            }
        }
        this.debug(`cleared context ${this.count} id=${this.id} (${count} deletables)`);
    }

    private hungRequestCallback() {
        if (!this.finished) this.flushBuffer(`Hung request was detected`);
    }

}
