/**
 * Copyright (c) 2024 Capital One
*/
import { Util } from "./util.js";

export enum Category {
    Small = "S",
    Medium = "M",
    Large = "L",
};

export type CategorizerFcn = (ele: any) => number;

export interface Categorizer {
    getCategory(ele: any): Category;
    getNumCategory(num: number): Category;
}

/**
 * ZScoreCategorizer takes an array of numeric values (or objects from which we get some numeric measurement).
 * Categorize an element's size based on it's Z-score.
 * The Z-score of X is "(X - average) / standardDeviation".
 */
export class ZScoreCategorizer implements Categorizer {

    private readonly fcn: CategorizerFcn;
    private readonly largeThresh: number;
    private readonly smallThresh: number;
    private readonly avg: number;
    private readonly std: number;

    constructor(eles: any[], opts?: { fcn?: CategorizerFcn, largeThresh?: number, smallThresh?: number}) {
        opts = opts || {};
        this.fcn = opts.fcn || function(num: number) {return num};
        this.smallThresh = opts.smallThresh || -1;
        this.largeThresh = opts.largeThresh || 1;
        const nums = eles.map(this.fcn);
        this.avg = Util.average(nums);
        this.std = Util.std(nums, this.avg);
    }

    public getNumZScore(num: number): number {
        return (num - this.avg) / this.std;
    }

    public getNumCategory(num: number): Category {
        const zScore = this.getNumZScore(num);
        if (zScore < this.smallThresh) return Category.Small;
        if (zScore > this.largeThresh) return Category.Large;
        return Category.Medium;
    }

    public getCategory(ele: any): Category {
        return this.getNumCategory(this.fcn(ele));
    }

}

/**
 * Categorize an element's size based on it's size.
 */
export class StaticCategorizer implements Categorizer {

    private readonly fcn: CategorizerFcn;
    private readonly minMedium: number;
    private readonly maxMedium: number;

    constructor(minMedium: number, maxMedium: number, opts?: {fcn?: CategorizerFcn}) {
        opts = opts || {};
        this.fcn = opts.fcn || function(num: number) {return num};
        this.minMedium = minMedium;
        this.maxMedium = maxMedium;
    }

    public getNumCategory(num: number): Category {
        if (num < this.minMedium) return Category.Small;
        if (num > this.maxMedium) return Category.Large;
        return Category.Medium;
    }

    public getCategory(ele: any): Category {
        return this.getNumCategory(this.fcn(ele));
    }

}
