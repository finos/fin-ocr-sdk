/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { cv } from './ocv.js';
import { Config } from './config.js';
import { Context } from './context.js';
import { Contour, FilterContourOpts } from './contour.js';
import { Color } from './color.js';
import { Line } from './line.js';
import { OCR } from './ocr.js';
import { Util, MinMaxRect } from './util.js';

export interface ContourInfo {
    vector: cv.MatVector;
    contours: Contour[];
}

export interface CropFraction {
    height?: number;
    width?: number;
}

export interface CropArgs {
    begin?: CropFraction;
    end?: CropFraction;
}

export interface GetContoursOpts extends FilterContourOpts {
    name?: string;
    mode?: number;
    method?: number;
};

export interface PerformOverlapCorrectionOpts extends GetContoursOpts {
    padding: number;
}

export interface DrawContoursOpts extends GetContoursOpts {
    name?: string;
    contours?: Contour[];
    contourInfo?: ContourInfo;
    color?: cv.Scalar;
    thickness?: number;
    box?: boolean;
    point?: boolean;
    label?: boolean;
    logPoints?: boolean;
    display?: boolean;
}

export interface GetLinesOpts extends GetContoursOpts {
    contours?: Contour[];
}

export type IsEligibleFcn = (contour: Contour) => boolean;

export type IsBetterFcn = (contour1: Contour, contour2: Contour) => boolean;

export type Frag = cv.Point[];

export type Frags = Frag[];

export enum ImageFormat {
    TIF = "image/tiff",
    PNG = "image/png",
    GIF = "image/gif",
    JPG = "image/jpeg",
    BMP = "image/bmp",
    X_MS_BMP = "image/x-ms-bmp",
}

const imageFormatMap: { [str: string]: ImageFormat } = {
    "image/tiff": ImageFormat.TIF,
    "tif": ImageFormat.TIF,
    "tiff": ImageFormat.TIF,
    "image/png": ImageFormat.PNG,
    "png": ImageFormat.PNG,
    "image/gif": ImageFormat.GIF,
    "gif": ImageFormat.GIF,
    "image/jpeg": ImageFormat.JPG,
    "jpg": ImageFormat.JPG,
    "jpeg": ImageFormat.JPG,
    "image/bmp": ImageFormat.BMP,
    "bmp": ImageFormat.BMP,
    "image/x_ms_bmp": ImageFormat.X_MS_BMP,
    "x_ms_bmp": ImageFormat.X_MS_BMP,
}

// If buffer is a string, it is base64 encode; otherwise, it is an ArrayBuffer.
// The tsoa package does not handle "ArrayBuffer" for some reason, so make it "any".
// export type ImageBuffer = string | ArrayBuffer;
export type ImageBuffer = string | any;

export interface ImageInput {
    format: string;
    buffer: ImageBuffer;
}

export interface ImageInfo extends ImageInput {
    width: number;
    height: number;
}

export interface NamedImageInfo extends ImageInfo {
    name: string;
}

export interface SkeletonPoint {
    x: number;
    y: number;
    isIntersection: boolean;
}

export interface Neighbor {
    x: number;
    y: number;
    dir: string;
}

// Values to add to X and Y values in order to visit neighbors of a point
export const neighbors: Neighbor[] = [
    { x: 1, y: 0, dir: "right" },
    { x: 1, y: 1, dir: "up-right" },
    { x: 0, y: 1, dir: "up" },
    { x: -1, y: 1, dir: "up-left" },
    { x: -1, y: 0, dir: "left" },
    { x: -1, y: -1, dir: "down-left" },
    { x: 0, y: -1, dir: "down" },
    { x: 1, y: -1, dir: "down-right" },
];

/**
 * An image.
 **/
export class Image {

    public static fromBuffer(buf: ArrayBuffer, ocr: OCR, ctx: Context, opts?: { name?: string, format?: ImageFormat }): Image {
        opts = opts || {};
        const name = opts.name || "original";
        const mat = Util.bufferToMat(buf, opts);
        ctx.addDeletable(mat);
        return new Image(name, mat, ocr, ctx);
    }

    public static fromHTMLElement(ele: HTMLElement, ocr: OCR, ctx: Context, opts?: { name?: string, format?: ImageFormat }): Image {
        opts = opts || {};
        const name = opts.name || "original";
        const mat = cv.imread(ele);
        ctx.addDeletable(mat);
        return new Image(name, mat, ocr, ctx);
    }

    public static strToImageFormat(str?: string, errIfNotFound?: boolean): ImageFormat | undefined {
        if (!str) return undefined;
        const rtn = imageFormatMap[str.toLowerCase()];
        if (errIfNotFound && !rtn) throw new Error(`Invalid image type: '${str}'; expecting one of ${JSON.stringify(Object.keys(imageFormatMap))}`);
        return rtn;
    }

    public readonly name: string;
    public readonly mat: cv.Mat;
    public readonly width: number;
    public readonly height: number;
    public readonly rect: cv.Rect;
    public readonly ctx: Context;
    public readonly cfg: Config;
    public readonly ocr: OCR;

    public blackOnWhite = false;

    public constructor(name: string, mat: cv.Mat, ocr: OCR, ctx: Context) {
        this.name = name;
        this.mat = mat;
        const size = mat.size();
        if (size.height === 0 || size.width === 0) throw new Error(`image ${name} has 0 size: ${JSON.stringify(size)}`);
        this.width = size.width;
        this.height = size.height;
        this.rect = new cv.Rect(0, 0, this.width, this.height);
        this.ctx = ctx;
        this.ocr = ocr;
        this.cfg = ocr.cfg;
    }

    public crop(args: CropArgs, opts?: { name?: string }): Image {
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`Cropping image: ${JSON.stringify(args)}`);
        opts = opts || {};
        const name = opts.name || "cropped";
        const begin = args.begin || {};
        const beginHeight = begin.height || 0;
        const beginWidth = begin.width || 0;
        const end = args.end || {};
        const endHeight = end.height || 1;
        const endWidth = end.width || 1;
        this.assertFraction(beginHeight, "begin.height");
        this.assertFraction(beginWidth, "begin.width");
        this.assertFraction(endHeight, "end.height");
        this.assertFraction(endWidth, "end.width");
        const height = this.mat.rows;
        const width = this.mat.cols;
        const x = width * beginWidth;
        const y = height * beginHeight;
        const w = width * endWidth - x;
        const h = height * endHeight - y;
        return this.roi(name, new cv.Rect(x, y, w, h));
    }

    public size(): cv.Size {
        return this.mat.size();
    }

    public resize(size: cv.Size, opts?: { name?: string }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || `${this.name}-resized`;
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.resize(self.mat, newMat, size, 0, 0, cv.INTER_AREA);
        });
    }

    public resizeByProportion(proportion: number, opts?: { name?: string }): Image {
        const size = this.mat.size();
        size.height = Math.round(size.height * proportion);
        size.width = Math.round(size.width * proportion);
        return this.resize(size, opts);
    }

    public bitwiseNot(opts?: { name?: string }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || "bitwise-not";
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.bitwise_not(self.mat, newMat);
        });
    }

    public grayScale(opts?: { name?: string }): Image {
        if (this.mat.type() === 0) {
            // Is already gray scale
            return this;
        }
        const self = this;
        opts = opts || {};
        const name = opts.name || "gray";
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.cvtColor(self.mat, newMat, cv.COLOR_BGR2GRAY);
        });
    }

    public rgb(opts?: { name?: string }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || "rgb";
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.cvtColor(self.mat, newMat, cv.COLOR_GRAY2RGB);
        });
    }

    public gaussianBlur(opts?: { name?: string, dimension?: number, size?: cv.Size }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || "gaussian-blur";
        const dimension = opts.dimension || 3;
        const size = opts.size || this.newSize(dimension, dimension);
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.GaussianBlur(self.mat, newMat, size, 0);
        });
    }

    public threshold(type: number, opts?: { name?: string, thresh?: number, max?: number }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || "thresh";
        const thresh = opts.thresh || 0;
        const max = opts.max || 255;
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.threshold(self.mat, newMat, thresh, max, type);
        });
    }

    public adaptiveThreshold(method: number, type: number, opts?: { name?: string, max?: number, blockSize?: number, C?: number }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || "adaptive-thresh";
        const max = opts.max || 255;
        const blockSize = opts.blockSize || 19;
        const C = opts.C || 1;
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.adaptiveThreshold(self.mat, newMat, max, method, type, blockSize, C);
        });
    }

    public erode(opts?: { name?: string, width?: number, height?: number, iterations?: number }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || "erosion";
        const width = opts.width || 2;
        const height = opts.height || 2;
        const iterations = opts.iterations || 1;
        const kernel = this.newKernel(width, height);
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.erode(self.mat, newMat, kernel, new cv.Point(-1, -1), iterations);
        });
    }

    public normalize(): Image {
        const self = this;
        return this.newImage("Normalized", (newMat: cv.Mat) => {
            cv.normalize(self.mat, newMat);
        });
    }

    public dilate(opts?: { name?: string, width?: number, height?: number, iterations?: number }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || "dilation";
        const width = opts.width || 2;
        const height = opts.height || 2;
        const iterations = opts.iterations || 1;
        const kernel = this.newKernel(width, height);
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.dilate(self.mat, newMat, kernel, new cv.Point(-1, -1), iterations);
        });
    }

    public open(opts?: { name?: string, width?: number, height?: number, iterations?: number }): Image {
        opts = opts || {};
        opts.name = opts.name || "opened";
        return this.morph(cv.MORPH_OPEN, opts);
    }

    public close(opts?: { name?: string, width?: number, height?: number, iterations?: number }): Image {
        opts = opts || {};
        opts.name = opts.name || "closed";
        return this.morph(cv.MORPH_CLOSE, opts);
    }

    /**
     * Perform a morphology operation on a source image and return the morphed image.
     * @param op The openCV operation associated with this operation (cv.MORPH_*)
     * @param opts The options associated with this morphololgy
     * @returns The new image for the morphed image.
     */
    public morph(op: number, opts?: { name?: string, size?: cv.Size, dimension?: number, width?: number, height?: number, anchor?: cv.Point, iterations?: number }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || "morph";
        const width = opts.width || opts.dimension || 17;
        const height = opts.height || opts.dimension || 7;
        const kernel = this.newKernel(width, height);
        const anchor = opts.anchor || new cv.Point(-1, -1);
        const iterations = opts.iterations || 1;
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.morphologyEx(self.mat, newMat, op, kernel, anchor, iterations);
        });
    }

    public roi(name: string, rect: cv.Rect, opts?: { type?: number }): Image {
        opts = opts || {};
        const type = 'type' in opts ? opts.type as number : this.mat.type();
        const x2 = rect.x + rect.width;
        const y2 = rect.y + rect.height;
        if (x2 > this.width || y2 > this.height) {
            throw new Error(`Rectangle expands beyond image boundary: width=${JSON.stringify(this.width)}, height=${this.height}, rectangle=${JSON.stringify(rect)}`);
        }
        const roiMat = this.mat.roi(rect);
        const newMat = this.newCustomMat(rect.height, rect.width, type);
        roiMat.copyTo(newMat);
        roiMat.delete();
        return new Image(name, newMat, this.ocr, this.ctx);
    }

    public getRect(rect: cv.Rect): cv.Rect | undefined {
        const outerRect = Util.toMinMaxRect(rect);
        let innerRect: MinMaxRect | undefined;
        for (let x = outerRect.x.min; x <= outerRect.x.max; x++) {
            for (let y = outerRect.y.min; y <= outerRect.y.max; y++) {
                if (this.isSet(x, y)) {
                    if (innerRect) {
                        innerRect.x.min = Math.min(innerRect.x.min, x);
                        innerRect.x.max = Math.max(innerRect.x.max, x);
                        innerRect.y.min = Math.min(innerRect.y.min, y);
                        innerRect.y.max = Math.max(innerRect.y.max, y);
                    } else {
                        innerRect = { x: { min: x, max: x }, y: { min: y, max: y } };
                    }
                }
            }
        }
        if (innerRect) {
            return Util.fromMinMaxRect(innerRect);
        }
        return undefined;
    }

    public isSet(x: number, y: number): boolean {
        const isWhite = this.getPixelVal(x, y) > 128;
        return this.blackOnWhite ? !isWhite : isWhite;
    }

    public set(x: number, y: number) {
        this.setPixelVal(x, y, this.blackOnWhite ? 0 : 255);
    }

    public unSet(x: number, y: number) {
        this.setPixelVal(x, y, this.blackOnWhite ? 255 : 0);
    }

    public getPixelVal(x: number, y: number): number {
        return this.mat.ucharPtr(y, x)[0];
    }

    public setPixelVal(x: number, y: number, val: number) {
        this.mat.ucharPtr(y, x)[0] = val;
    }

    public getContours(opts?: GetContoursOpts): Contour[] {
        const ci = this.getContourInfo(opts);
        return ci.contours;
    }

    public getContourInfo(opts?: GetContoursOpts): ContourInfo {
        opts = opts || {};
        const mode = opts.mode || cv.RETR_EXTERNAL;
        const method = opts.method || cv.CHAIN_APPROX_SIMPLE;
        const vector = this.newMatVector();
        const hierarchy = this.newMat();
        let mat = this.mat;
        cv.findContours(mat, vector, hierarchy, mode, method);
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`total number of contours returned by opencv: ${vector.size()}`);
        let contours: Contour[] = [];
        for (let i = 0; ; i++) {
            const c = vector.get(i);
            if (!c) break;
            this.ctx.addDeletable(c);
            contours.push(new Contour(c, this));
        }
        contours = Util.filterContours(contours, opts);
        // Sort left-to-right
        contours.sort((a, b) => a.rect.x - b.rect.x);
        for (let idx = 0; idx < contours.length; idx++) {
            const contour = contours[idx] as Contour;
            contour.idx = idx;
        }
        if (this.ctx.isDebugEnabled()) this.ctx.debug(`${contours.length} contours found in image ${this.name}`);
        return { vector, contours };
    }

    public display(name?: string) {
        this.ctx.addImage(this, name);
    }

    public drawBoxes(name: string, rects: cv.Rect[], opts?: { color?: cv.Scalar, pad?: number, thickness?: number, display?: boolean }): Image {
        opts = opts || {};
        const color = opts.color || Color.red;
        const thickness = opts.thickness || 1;
        const pad = opts.pad || 0;
        const display = 'display' in opts ? opts.display : true;
        const s = this.mat.size();
        const image = this.rgb({ name });
        for (const rect of rects) {
            const x1 = Math.max(rect.x - pad, 0);
            const y1 = Math.max(rect.y - pad, 0);
            const x2 = Math.min(rect.x + rect.width + pad, s.width - 1);
            const y2 = Math.min(rect.y + rect.height + pad, s.height - 1);
            const pt1 = new cv.Point(x1, y1);
            const pt2 = new cv.Point(x2, y2);
            cv.rectangle(image.mat, pt1, pt2, color, thickness);
        }
        if (display) image.display();
        return image;
    }

    public drawBox(name: string, rect: cv.Rect, opts?: { color?: cv.Scalar, pad?: number, thickness?: number, display?: boolean }): Image {
        return this.drawBoxes(name, [rect], opts);
    }

    public drawPoint(x: number, y: number, opts?: { color?: Color, radius?: number }) {
        opts = opts || {};
        const color = opts.color || Color.red;
        const radius = 'radius' in opts ? opts.radius as number : 1;
        cv.circle(this.mat, new cv.Point(x, y), radius, color, -1);
    }

    public drawContours(opts?: DrawContoursOpts): Image {
        opts = opts || {};
        const ctx = this.ctx;
        const name = opts.name || `${this.name}-contours`;
        const color = opts.color || Color.red;
        const thickness = opts.thickness || 1;
        const box = 'box' in opts ? opts.box : true;
        const point = opts.point || false;
        const label = 'label' in opts ? opts.label : true;
        const logVertices = opts.logPoints || false;
        const display = 'display' in opts ? opts.display as boolean : true;
        let contours = opts.contours;
        let vector: cv.MatVector | undefined;
        if (point) {
            if (contours) throw new Error(`'point' is compatible with 'contourInfo' but not with 'contours'`);
            const ci = opts.contourInfo || this.getContourInfo(opts);
            contours = ci.contours;
            vector = ci.vector;
        }
        if (!contours) contours = this.getContours(opts);
        const pad = thickness;
        const tpad = 1;
        const bpad = 200;
        const lpad = 1;
        const rpad = 1;
        const img = this.mat;
        let newMat = this.newCustomMat(img.cols + lpad + rpad, img.rows + tpad + bpad, cv.CV_8UC3);
        cv.copyMakeBorder(img, newMat, tpad, bpad, lpad, rpad, cv.BORDER_CONSTANT, Color.white);
        cv.cvtColor(newMat, newMat, cv.COLOR_GRAY2RGB);
        const minLabelY = newMat.size().height - 180;
        const maxLabelY = newMat.size().height - 10;
        let labelY = minLabelY;
        if (box || !label) {
            for (let i = 0; i < contours.length; i++) {
                const contour = contours[i] as Contour;
                const rect = contour.rect;
                if (box) {
                    Util.drawRect(newMat, rect, color, thickness, pad);
                }
                if (vector) {
                    cv.drawContours(newMat, vector, i, color, thickness);
                }
                if (label) {
                    const labelPt = this.newPoint(rect.x - pad, labelY);
                    cv.putText(newMat, `${contour.idx}:${contour.size ? contour.size : ""}:${contour.area}`, labelPt, cv.FONT_HERSHEY_PLAIN, 0.8, color, 1);
                    labelY += 12;
                    if (labelY > maxLabelY) labelY = minLabelY;
                }
                if (logVertices) {
                    const vertices = Util.getVertices(contour.mat);
                    ctx.debug(`${vertices.length} vertices for ${name}:${i}: ${JSON.stringify(vertices)}`);
                }
            }
        }
        const rtn = new Image(name, newMat, this.ocr, this.ctx);
        if (display) rtn.display();
        return rtn;
    }

    public drawLines(lines: Line[], opts?: { name?: string, color?: cv.Scalar, thickness?: number }): Image {
        if (this.ctx.isVerboseEnabled()) this.ctx.verbose(`drawLines enter - image=${this.name}`);
        opts = opts || {};
        const name = opts.name || `${this.name}-lines`;
        const color = opts.color || Color.red;
        const thickness = opts.thickness || 1;
        const tpad = 1;
        const bpad = 1;
        const lpad = 1;
        const rpad = 35;
        const img = this.mat;
        let newMat = this.newCustomMat(img.cols + lpad + rpad, img.rows + tpad + bpad, cv.CV_8UC3);
        cv.copyMakeBorder(img, newMat, tpad, bpad, lpad, rpad, cv.BORDER_CONSTANT, Color.white);
        cv.cvtColor(newMat, newMat, cv.COLOR_GRAY2RGB);
        for (const line of lines) {
            const rect = line.getBoundingRect();
            Util.drawRect(newMat, rect, color, thickness, 0);
            const pt = this.newPoint(img.size().width + 5, rect.y + Math.round(rect.height / 2));
            cv.putText(newMat, `${line.idx}:${line.count}`, pt, cv.FONT_HERSHEY_PLAIN, 1, color, 1);
        }
        const rtn = new Image(name, newMat, this.ocr, this.ctx);
        rtn.display();
        if (this.ctx.isVerboseEnabled()) this.ctx.verbose(`drawLines exit - image=${this.name}`);
        return rtn;
    }

    public findBestContour(contours: Contour[], isBetterFcn: IsBetterFcn, isEligibleFcn?: IsEligibleFcn): Contour | undefined {
        let bestContour: Contour | undefined;
        for (let i = 0; i < contours.length; i++) {
            const c = contours[i] as Contour;
            if (isEligibleFcn && !isEligibleFcn(c)) continue;
            if (!bestContour || isBetterFcn(bestContour, c)) {
                bestContour = c;
            }
        }
        return bestContour;
    }

    public findLargestContour(contours: Contour[], isEligibleFcn?: IsEligibleFcn): Contour | undefined {
        return this.findBestContour(
            contours,
            function (c1: Contour, c2: Contour): boolean {
                return c2.area > c1.area;
            },
            isEligibleFcn
        );
    }

    public skewAngle(): number {
        // Prepare image by converting gray scale to gaussian blur, then OTSU's threshold
        let img = this.grayScale({ name: "skew-gray" });
        img = img.gaussianBlur({ name: "skew-blur", dimension: 7 });
        img = img.threshold(cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
        // Dilate to merge text into lines.
        // Use large kernel on X asis to merge characters into single line canceling out any spaces.
        img = img.dilate({ name: "skew-dilation", width: 25, height: 1, iterations: 1 });
        // Find the best skew contour
        const skewContour = img.findSkewContourV3();
        if (!skewContour) {
            if (this.ctx.isDebugEnabled()) this.ctx.debug(`skew contour was not found`);
            return 0;
        }
        if (this.ctx.debugImages) this.drawBox("skew-contour", skewContour.rect);
        return skewContour.skewAngleV1();
    }

    // Largest
    public findSkewContourV1(opts?: GetContoursOpts): Contour | undefined {
        const self = this;
        const contours = this.getContours(opts);
        if (this.ctx.debugImages) this.drawContours({ name: "skew-contours", contours })
        const skewContour = this.findLargestContour(
            contours,
            function (contour: Contour): boolean {
                const rect = contour.rect;
                return !Util.rectTouchesBorder(rect, self.mat);
            }
        );
        return skewContour;
    }

    // Nearest bottom
    public findSkewContourV2(opts?: GetContoursOpts): Contour | undefined {
        const self = this;
        const contours = this.getContours(opts);
        this.drawContours({ name: "dialation-contours", contours })
        const skewContour = this.findBestContour(
            contours,
            function (contour1: Contour, contour2: Contour) {
                return contour2.rect.y > contour1.rect.y;
            },
            function (contour: Contour): boolean {
                const rect = contour.rect;
                return rect.width > 100 && rect.height > 17 && rect.height < 100 && !Util.rectTouchesBorder(rect, self.mat);
            }
        );
        return skewContour;
    }

    // Best rectangle fit
    public findSkewContourV3(opts?: GetContoursOpts): Contour | undefined {
        const self = this;
        opts = opts || {};
        opts.mode = 'mode' in opts ? opts.mode : cv.RETR_LIST;
        const contours = this.getContours(opts);
        if (this.ctx.debugImages) this.drawContours({ name: "skew-dialation-contours", contours })
        const skewContour = this.findBestContour(
            contours,
            function (contour1: Contour, contour2: Contour) {
                const r1 = contour1.areaFitRatio();
                const r2 = contour2.areaFitRatio();
                const r2Better = r2 < r1;
                return r2Better;
            },
            function (contour: Contour): boolean {
                const rect = contour.rect;
                const touchesBorder = Util.rectTouchesBorder(rect, self.mat);
                const candidate = rect.width > 120 && rect.height > 10 && rect.height < 100 && !touchesBorder;
                self.ctx.debug(`contour ${contour.idx}: candidate=${candidate}, fitRatio=${contour.areaFitRatio()}, rect=${JSON.stringify(contour.rect)}`);
                return candidate;
            }
        );
        return skewContour;
    }

    // Closest to origin
    public findSkewContourV4(opts?: GetContoursOpts): Contour | undefined {
        const self = this;
        const contours = this.getContours(opts);
        if (this.ctx.debugImages) this.drawContours({ name: "skew-dialation-contours", contours })
        const skewContour = this.findBestContour(
            contours,
            function (contour1: Contour, contour2: Contour) {
                const d1 = contour1.distanceFromOrigin();
                const d2 = contour2.distanceFromOrigin();
                const c2Better = d2 < d1;
                return c2Better;
            },
            function (contour: Contour): boolean {
                const rect = contour.rect;
                const touchesBorder = Util.rectTouchesBorder(rect, self.mat);
                const candidate = rect.width > 40 && rect.height > 10 && rect.height < 100 && !touchesBorder;
                return candidate;
            }
        );
        return skewContour;
    }

    // Nearest top
    public findSkewContourV5(opts?: GetContoursOpts): Contour | undefined {
        const self = this;
        const contours = this.getContours(opts);
        if (this.ctx.debugImages) this.drawContours({ name: "skew-dialation-contours", contours })
        const skewContour = this.findBestContour(
            contours,
            function (contour1: Contour, contour2: Contour) {
                const y1 = contour1.rect.y;
                const y2 = contour2.rect.y;
                const c2Better = y2 < y1;
                return c2Better;
            },
            function (contour: Contour): boolean {
                const rect = contour.rect;
                const touchesBorder = Util.rectTouchesBorder(rect, self.mat);
                const candidate = rect.width > 70 && rect.height > 10 && rect.height < 100 && !touchesBorder;
                return candidate;
            }
        );
        return skewContour;
    }

    public rotate(angle: number, opts?: { name?: string }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || `rotated-${this.name}`;
        const width = this.mat.cols;
        const height = this.mat.rows;
        const size = this.newSize(width, height);
        const center = new cv.Point(Math.floor(width / 2), Math.floor(height / 2));
        return this.newImage(name, (newMat: cv.Mat) => {
            const matrix = cv.getRotationMatrix2D(center, angle, 1.0);
            cv.warpAffine(self.mat, newMat, matrix, size, cv.INTER_CUBIC, cv.BORDER_REPLICATE);
            matrix.delete();
        });
    }

    public border(opts?: { name?: string, color?: cv.Scalar, top?: number, bottom?: number, left?: number, right?: number, default?: number }): Image {
        const self = this;
        opts = opts || {};
        const name = opts.name || "bordered";
        const color = opts.color || Color.red;
        const def = opts.default || 10;
        const top = opts.top || def;
        const bottom = opts.bottom || def;
        const left = opts.left || def;
        const right = opts.right || def;
        return this.newImage(name, (newMat: cv.Mat) => {
            cv.copyMakeBorder(self.mat, newMat, top, bottom, left, right, cv.BORDER_CONSTANT, color);
        });
    }

    public deskew(opts?: { name?: string }): Image {
        opts = opts || {};
        const name = opts.name || "deskewed";
        const angle = this.skewAngle();
        if (angle == 0) return this;
        return this.rotate(angle, { name });
    }

    public canny(opts?: { name?: string, lowerThreshold?: number, upperThreshold?: number, apertureSize?: number, l2Gradient?: boolean }): Image {
        opts = opts || {};
        const name = opts.name || "canny";
        const lt = opts.lowerThreshold || 50;
        const ut = opts.upperThreshold || 100;
        const a = opts.apertureSize || 3;   // kernel size for sobel; must be 3, 5, or 7
        const g = opts.l2Gradient || false;
        const dst = this.ctx.newMat();
        cv.Canny(this.mat, dst, lt, ut, a, g);
        return new Image(name, dst, this.ocr, this.ctx);
    }

    public houghLines(opts?: { rho?: number, theta?: number, threshold?: number, minLineLength?: number, maxLineGap?: number }): Image {
        opts = opts || {};
        const rho = opts.rho || 1;
        const theta = opts.theta || Math.PI / 180;
        const threshold = opts.threshold || 2;
        const minLineLength = opts.minLineLength || 5;
        const maxLineGap = opts.maxLineGap || 2;
        const ctx = this.ctx;
        const lines = ctx.newMat();
        cv.HoughLinesP(this.mat, lines, rho, theta, threshold, minLineLength, maxLineGap);
        const dst = cv.Mat.zeros(this.mat.rows, this.mat.cols, cv.CV_8UC3);
        for (let i = 0; i < lines.rows; i++) {
            const sp = new cv.Point(lines.data32S[i * 4] as number, lines.data32S[i * 4 + 1] as number);
            const ep = new cv.Point(lines.data32S[i * 4 + 2] as number, lines.data32S[i * 4 + 3] as number);
            const dx = ep.x - sp.x;
            const dy = ep.y - sp.y;
            const angleRadiants = Math.atan2(dy, dx);
            let angle = angleRadiants * 180 / Math.PI;
            angle = Math.abs(angle);
            cv.line(dst, sp, ep, Color.red);
        }
        return new Image("lines", dst, this.ocr, ctx);
    }

    public isNeighborSet(x: number, y: number, n: Neighbor): boolean {
        return this.isSet(x + n.x, y + n.y);
    }

    public getSkeletonFragments(rect: cv.Rect, opts?: { name?: string, skeletonize?: boolean, csize?: number, maxIter?: number }): Frags {
        const ctx = this.ctx;
        opts = opts || {};
        const name = opts.name || "skeletonize";
        const skeletonize = 'skeletonize' in opts ? opts.skeletonize : true;
        const csize = opts.csize || 10;
        const maxIter = opts.maxIter || 999;
        ctx.debug(`traceSkeleton: begin; rect=${JSON.stringify(rect)}`);
        const img = skeletonize ? this.getSkeletonImage({ name, rect }) : this;
        const rtn = img.traceSkeleton(rect, csize, maxIter);
        ctx.debug(`traceSkeleton: end; rtn=${JSON.stringify(rtn)}`);
        return rtn;
    }

    /**
     * traceSkeleton implements the algorithm described at https://github.com/LingDong-/skeleton-tracing/tree/master?tab=readme-ov-file#introduction.
     * It is an adaptation of https://github.com/LingDong-/skeleton-tracing/blob/master/js/trace_skeleton.vanilla.js
     * @param opts 
     * @returns 
     */
    private traceSkeleton(rect: cv.Rect, csize: number, maxIter: number): Frags {
        const ctx = this.ctx;
        ctx.debug(`traceSkeleton: enter traceSkeleton maxIter=${maxIter}, rect=${JSON.stringify(rect)}`);
        let frags: Frags = [];
        if (maxIter == 0) return frags;
        if (rect.width <= csize && rect.height <= csize) { // recursive bottom
            ctx.debug(`traceSkeleton: small size ${JSON.stringify(rect)}`);
            return this.chunkToFrags(rect);
        }
        const r = Util.toMinMaxRect(rect);
        // Find best horizontal or vertical seam candidate by splitting on Y axis
        let ms = rect.width + rect.height; // number of set pixels on the seam, less the better
        let bestX = -1;
        let bestY = -1;
        if (rect.height > csize) { // try to find the bestY to split horizontally
            const midY = Math.round((r.y.min + r.y.max) / 2);
            for (let y = r.y.min + 3; y <= r.y.max - 3; y++) {
                // If any on the 4 corners are set, skip this row
                if (this.isSet(r.x.min, y) || this.isSet(r.x.max, y) || this.isSet(r.x.min, y - 1) || this.isSet(r.x.max, y - 1)) continue;
                let s = 0;
                for (let x = r.x.min; x <= r.x.max; x++) {
                    if (this.isSet(x, y)) s++;
                    if (this.isSet(x, y - 1)) s++;
                }
                if (s < ms || (s == ms && Math.abs(y - midY) < Math.abs(bestY - midY))) {
                    ms = s;
                    bestY = y;
                }
            }
        }
        if (rect.width > csize) { // try to find the bestX to split vertically
            const midX = Math.round((r.x.min + r.x.max) / 2);
            for (var x = r.x.min + 3; x <= r.x.max - 3; x++) {
                // If any on the 4 corners are set, skip this column
                if (this.isSet(x, r.y.min) || this.isSet(x, r.y.max) || this.isSet(x - 1, r.y.min) || this.isSet(x - 1, r.y.max)) continue;
                let s = 0;
                for (let y = r.y.min; y <= r.y.max; y++) {
                    if (this.isSet(x, y)) s++;
                    if (this.isSet(x - 1, y)) s++;
                }
                if (s < ms || (s == ms && Math.abs(x - midX) < Math.abs(bestX - midX))) {
                    ms = s;
                    bestX = x;
                    bestY = -1;
                }
            }
        }
        ctx.debug(`traceSkeleton: bestX=${bestX}, bestY=${bestY}`);
        // Split horizontally or vertically, depending on bestX or bestY
        if (bestY != -1) { // split horizontally
            const top = new cv.Rect(rect.x, rect.y, rect.width, bestY - rect.y);
            const bottom = new cv.Rect(rect.x, bestY, rect.width, rect.height - top.height);
            ctx.debug(`traceSkeleton: splitting horizontally at Y=${bestY}; top=${JSON.stringify(top)}, bottom=${JSON.stringify(bottom)}`);
            if (!this.isEmpty(top)) {
                frags = this.traceSkeleton(top, csize, maxIter - 1);
            }
            if (!this.isEmpty(bottom)) {
                frags = this.mergeFrags(frags, this.traceSkeleton(bottom, csize, maxIter - 1), true, bestY);
            }
        } else if (bestX != -1) { // split vertically 
            const left = new cv.Rect(rect.x, rect.y, bestX - rect.x - 1, rect.height);
            const right = new cv.Rect(bestX, rect.y, rect.width - left.width, rect.height);
            ctx.debug(`traceSkeleton: splitting vertically at X=${bestX}; left=${JSON.stringify(left)}, right=${JSON.stringify(right)}`);
            if (!this.isEmpty(left)) {
                frags = this.traceSkeleton(left, csize, maxIter - 1);
            }
            if (!this.isEmpty(right)) {
                frags = this.mergeFrags(frags, this.traceSkeleton(right, csize, maxIter - 1), false, bestX);
            }
        } else { // no more splitting
            frags = this.chunkToFrags(rect);
        }
        return frags;
    }

    /**
     * Merge frags2 into frags1.
     * See step 6 from algorithm at https://github.com/LingDong-/skeleton-tracing?tab=readme-ov-file#algorithm-description
     * @param frags1 
     * @param frags2 
     * @param horizontal
     * @param seam  X value if horizontal is true; else, an Y value.
     */
    private mergeFrags(frags1: Frags, frags2: Frags, horizontal: boolean, seam: number): Frags {
        for (const frag of frags2) {
            if (this.mergeFrag(frags1, frag, true, horizontal, seam)) continue;
            if (this.mergeFrag(frags1, frag, false, horizontal, seam)) continue;
            this.ctx.debug(`traceSkeleton: failed to merge fragments along ${horizontal ? "horizontal" : "vertical"} seam ${seam}; frag=${JSON.stringify(frag)}, frags=${JSON.stringify(frags1)}`);
        }
        return frags1;
    }

    private mergeFrag(frags: Frags, frag: Frag, first: boolean, horizontal: boolean, seam: number): boolean {
        const ctx = this.ctx;
        const p = frag[first ? 0 : frag.length - 1] as cv.Point;
        const dir = horizontal ? "horizontal" : "vectical";
        if (!this.isPointOnSeam(p, horizontal, seam)) {
            ctx.debug(`traceSkeleton: point ${JSON.stringify(p)} is not on ${dir} seam ${seam}`);
            return false;
        }
        for (const f of frags) {
            const pFirst = f[0] as cv.Point;
            const pLast = f[f.length - 1] as cv.Point;
            if (this.pointMatches(p, pFirst, horizontal)) {
                if (first) frag = frag.reverse();
                f.splice(0, 0, ...frag);
                ctx.debug(`traceSkeleton: merge result first=${first}, p=${JSON.stringify(p)}, frags=${JSON.stringify(frags)}`);
                return true;
            }
            if (this.pointMatches(p, pLast, horizontal)) {
                if (!first) frag = frag.reverse();
                f.splice(f.length, 0, ...frag);
                ctx.debug(`traceSkeleton: merge result first=${first}, p=${JSON.stringify(p)}, frags=${JSON.stringify(frags)}`);
                return true;
            }
        }
        ctx.debug(`traceSkeleton: point ${JSON.stringify(p)} does not match any ${dir} fragments of ${JSON.stringify(frags)}`);
        return false;
    }

    private pointMatches(p1: cv.Point, p2: cv.Point, horizontal: boolean): boolean {
        const xDiff = Math.abs(p1.x - p2.x);
        const yDiff = Math.abs(p1.y - p2.y);
        if (horizontal) return (xDiff <= 1 && yDiff <= 4);
        return (yDiff <= 1 && xDiff <= 4);
    }

    private isPointOnSeam(point: cv.Point, horizontal: boolean, seam: number): boolean {
        if (horizontal) return point.y == seam || point.y == seam - 1;
        else return point.x == seam || point.x == seam - 1;
    }

    /**
     * Walk the 4 edges of the chunk and identify the "outgoing" pixels;
     * add segments connecting these pixels to center of chunk;
     * apply heuristics to adjust center of chunk
     * @param rect  rectangle identifying a subset of this image
     * @return the polyline fragments
     */
    private chunkToFrags(rect: cv.Rect): Frags {
        const ctx = this.ctx;
        const self = this;
        const r = Util.toMinMaxRect(rect);
        // walk around the border clockwise
        let contiguousPoints: cv.Point[] = [];
        const midPoints: cv.Point[] = [];
        Util.walkClockwise(r, function (x: number, y: number) {
            if (self.isSet(x, y)) {
                contiguousPoints.push(new cv.Point(x, y));
            } else if (contiguousPoints.length > 0) {
                midPoints.push(contiguousPoints[Math.floor(contiguousPoints.length / 2)] as cv.Point);
                contiguousPoints = [];
            }
        });
        let frags: Frags = [];
        if (midPoints.length == 1) { // return segment to center
            frags = [[midPoints[0] as cv.Point, new cv.Point(Math.round((r.x.min + r.x.max) / 2), Math.round((r.y.min + r.y.max) / 2))]];
        } else if (midPoints.length == 2) { // probably just a line, so connect them
            frags = [midPoints];
        } else if (midPoints.length > 2) { // it's a crossroad
            let bestPoint: cv.Point | undefined;
            let bestCount = 0;
            for (let x = r.x.min + 1; x < r.x.max; x++) {
                for (let y = r.y.min + 1; y < r.y.max; y++) {
                    const count = this.getNeighborCount(x, y);
                    if (!bestPoint || count > bestCount) {
                        bestPoint = new cv.Point(x, y);
                        bestCount = count;
                    }
                }
            }
            if (bestPoint) {
                for (const p of midPoints) {
                    frags.push([bestPoint, p]);
                }
            }
        }
        ctx.debug(`traceSkeleton: chunkToFrags midPoints.length=${midPoints.length}, result=${JSON.stringify(frags)}`);
        return frags;
    }

    // If none of the pixels in this rect are set, return true; otherwise, return true.
    public isEmpty(rect: cv.Rect): boolean {
        const r = Util.toMinMaxRect(rect);
        for (let x = r.x.min; x <= r.x.max; x++) {
            for (let y = r.y.min; y <= r.y.max; y++) {
                if (this.isSet(x, y)) return false;
            }
        }
        return true;
    }

    public getNeighborCount(x: number, y: number): number {
        let count = 0;
        if (this.isSet(x, y)) count++;
        for (const n of neighbors) {
            const tx = x + n.x;
            const ty = y + n.y;
            if (this.isSet(tx, ty)) count++;
        }
        return count;
    }

    public getSkeletonImage(opts?: { name?: string, rect?: cv.Rect }): Image {
        opts = opts || {};
        const name = opts.name || "skeleton";
        const img = this.clone(name);
        img.skeletonize(opts);
        return img;
    }

    /**
     * Skeletonize part of this image using the Zhang-Suen algorithm.
     * See https://rosettacode.org/wiki/Zhang-Suen_thinning_algorithm
     * 
     * NOTE: This algorithm doesn't create a skeleton image with only one neighbor except for intersections which would be ideal.
     *       See https://github.com/LingDong-/skeleton-tracing/tree/master?tab=readme-ov-file#introduction for a description of an algorithm
     *       and an implementation at https://github.com/LingDong-/skeleton-tracing/blob/master/js/trace_skeleton.vanilla.js
     *       We would need to convert this to typescript, but I am trying to see if I can do this without doing that.
     * @param opts
     */
    public skeletonize(opts?: { rect?: cv.Rect }) {
        opts = opts || {};
        const rect = opts.rect || this.rect;
        for (; ;) {
            if (!this.thin(rect, 0) && !this.thin(rect, 1)) break;
        }
    }

    private thin(rect: cv.Rect, iter: number): boolean {
        const r = Util.toMinMaxRect(rect);
        const getNum = (x: number, y: number) => this.isSet(x, y) ? 1 : 0;
        const trans = (prev: number, cur: number) => prev == 0 && cur == 1 ? 1 : 0;
        const points: cv.Point[] = [];
        for (let y = r.y.min + 1; y < r.y.max; y++) {
            for (let x = r.x.min + 1; x < r.x.max; x++) {
                if (!this.isSet(x, y)) continue;
                const p2 = getNum(x, y - 1);
                const p3 = getNum(x + 1, y - 1);
                const p4 = getNum(x + 1, y);
                const p5 = getNum(x + 1, y + 1);
                const p6 = getNum(x, y + 1);
                const p7 = getNum(x - 1, y + 1);
                const p8 = getNum(x - 1, y);
                const p9 = getNum(x - 1, y - 1);
                const A = trans(p2, p3) + trans(p3, p4) + trans(p4, p5) + trans(p5, p6) + trans(p6, p7) + trans(p7, p8) + trans(p8, p9) + trans(p9, p2);
                const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                const m1 = iter == 0 ? (p2 * p4 * p6) : (p2 * p4 * p8);
                const m2 = iter == 0 ? (p4 * p6 * p8) : (p2 * p6 * p8);
                if (A == 1 && (B >= 2 && B <= 6) && m1 == 0 && m2 == 0) {
                    points.push(new cv.Point(x, y));
                }
            }
        }
        for (const p of points) {
            this.unSet(p.x, p.y);
        }
        return points.length > 0;
    }

    /**
     * Clear vertical areas within the 'rect' rectangle of this image which are not thicker than the 'verticalThicknessThreshold'.
     * @param verticalThicknessThreshold The vertical thickness threshold
     * @param opts.rect A region within this image to inspect
    */
    public clearByVerticalThickness(verticalThicknessThreshold: number, opts?: { rect?: cv.Rect }) {
        opts = opts || {};
        const rect = opts.rect || this.rect;
        const r = Util.toMinMaxRect(rect);
        let x1 = -1;
        for (let x = r.x.min; x <= r.x.max; x++) {
            let y1 = -1;
            let y2 = -1;
            for (let y = r.y.min; y <= r.y.max; y++) {
                if (this.isSet(x, y)) {
                    if (y1 == -1) y1 = y;
                    y2 = y;
                }
            }
            const isThin = y1 >= 0 && (y2 - y1) <= verticalThicknessThreshold;
            if (isThin) {
                if (x1 == -1) x1 = x;
            } else {
                if (x1 >= 0) this.clearByBoundary([[x1, r.y.min], [x, r.y.min], [x, r.y.max], [x1, r.y.max]]);
                x1 = -1;
            }
        }
        if (x1 >= 0) this.clearByBoundary([[x1, r.y.min], [r.x.max, r.y.min], [r.x.max, r.y.max], [x1, r.y.max]]);
    }

    public clearPadding(padding: number) {
        const ctx = this.ctx;
        ctx.debug(`clearPadding begin`);
        // Clear top padding
        for (let y = 0; y < padding; y++) {
            for (let x = 0; x < this.width; x++) this.unSet(x, y);
        }
        // Clear bottom padding
        for (let y = this.height - padding; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) this.unSet(x, y);
        }
        // Clear left padding
        for (let x = 0; x < padding; x++) {
            for (let y = 0; y < this.height; y++) this.unSet(x, y);
        }
        // Clear right padding
        for (let x = this.width - padding; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) this.unSet(x, y);
        }
        ctx.debug(`clearPadding end`);
    }

    public hvThin(minH: number, minV: number, rect: cv.Rect, opts?: {maxIterations?: number}) {
        const ctx = this.ctx;
        opts = opts || {};
        const maxIterations = opts.maxIterations || 100;
        ctx.debug(`hvThin begin - rect=${JSON.stringify(rect)}, maxIterations=${maxIterations}`);
        const r = Util.toMinMaxRect(rect);
        let count = 0;
        for (;;) {
            count++;
            ctx.debug(`hvThin begin iteration ${count}`);
            if (!this.hvThinIteration(minH, minV, r)) break;
            if (count >= maxIterations) break;
        }
        ctx.debug(`hvThin completion after ${count} of ${maxIterations} iterations`);
    }

    private hvThinIteration(minH: number, minV: number, r: MinMaxRect): boolean {
        let changed = false;
        for (let x = r.x.min; x <= r.x.max; x++) {
            for (let y = r.y.min; y <= r.y.max; y++) {
                if (!this.isSet(x, y)) continue;
                const hc = this.getHCount(x, y, r);
                const vc = this.getVCount(x, y, r);
                if (hc < minH && vc < minV) {
                    this.unSet(x, y);
                    changed = true;
                }
            }
        }
        return changed;
    }

    private getHCount(x: number, y: number, r: MinMaxRect): number {
        let count = 1;
        // Count to right
        for (let x2 = x + 1; x2 <= r.x.max; x2++) {
            if (this.isSet(x2, y)) count++;
            else break;
        }
        // Count to left
        for (let x2 = x - 1; x2 >= r.x.min; x2--) {
            if (this.isSet(x2, y)) count++;
            else break;
        }
        return count;
    }

    private getVCount(x: number, y: number, r: MinMaxRect): number {
        let count = 1;
        // Count down
        for (let y2 = y + 1; y2 <= r.y.max; y2++) {
            if (this.isSet(x, y2)) count++;
            else break;
        }
        // Count up
        for (let y2 = y - 1; y2 >= r.y.min; y2--) {
            if (this.isSet(x, y2)) count++;
            else break;
        }
        return count;
    }

    /**
     * Clear everything on and inside the boundary points.
     * The boundary is formed by drawing a line between point 0 and 1, between 1 and 2, ... and between points.length-1 and 0.
     * @param points Each element of the outer array is an inner array of 2 numbers, x and y, respectively.
     */
    public clearByBoundary(points: number[][]) {
        // Create blank mask
        const type = this.mat.type();
        let mask = cv.Mat.zeros(this.height, this.width, type);
        // Create contours to be cleared
        const contours = new cv.MatVector();
        const mat = cv.matFromArray(1, points.length, cv.CV_32SC2, points.flat(2));
        contours.push_back(mat);
        // Draw contours to be cleared on mask
        const color = this.blackOnWhite ? Color.black : Color.white;
        cv.drawContours(mask, contours, 0, color, -1);
        // Flip bits in mask so that mask contains only what is to remain
        cv.bitwise_not(mask, mask);
        // Bitwise and with this image to keep all except what is to be deleted
        cv.bitwise_and(this.mat, mask, this.mat);
        // Cleanup
        mat.delete();
        mask.delete();
        contours.delete();
    }

    public dumpBits(rect: MinMaxRect) {
        const cs = this.ctx.cs;
        cs.log(`BEGIN dumpBits: ${JSON.stringify(rect)}`);
        for (let y = rect.y.min; y <= rect.y.max; y++) {
            const row: number[] = [];
            for (let x = rect.x.min; x <= rect.x.max; x++) {
                const isSet = this.isSet(x, y);
                row.push(isSet ? 1 : 0);
            }
            cs.log(`${y.toString().padStart(3)}: ${JSON.stringify(row)}`);
        }
        cs.log(`END dumpBits: ${JSON.stringify(rect)}`);
    }

    public dumpRangeBits(rect: MinMaxRect) {
        const cs = this.ctx.cs;
        cs.log(`BEGIN dumpRangeBits: ${JSON.stringify(rect)}`);
        for (let y = rect.y.min; y <= rect.y.max; y++) {
            const row: string[] = [];
            let first = -1;
            let last = -1;
            for (let x = rect.x.min; x <= rect.x.max; x++) {
                const isSet = this.isSet(x, y);
                if (isSet) {
                    if (first < 0) first = x;
                    last = x;
                } else if (first >= 0) {
                    row.push(`${first}-${last}`);
                    first = -1;
                }
            }
            cs.log(`${y.toString().padStart(3)}: ${JSON.stringify(row)}`);
        }
        cs.log(`END dumpRangeBits: ${JSON.stringify(rect)}`);
    }

    private newImage(name: string, fcn: (mat: cv.Mat) => void): Image {
        if (this.ctx.isVerboseEnabled()) this.ctx.verbose(`begin newImage ${name}`);
        const newImg = this.newMat();
        fcn(newImg);
        const rtn = new Image(name, newImg, this.ocr, this.ctx);
        if (this.ctx.isVerboseEnabled()) this.ctx.verbose(`end newImage ${name}`);
        return rtn;
    }

    public newMat(): cv.Mat {
        return this.ctx.newMat();
    }

    public newCustomMat(height: number, width: number, type: number): cv.Mat {
        return this.ctx.newCustomMat(height, width, type);
    }

    private newMatVector(): cv.MatVector {
        return this.ctx.newMatVector();
    }

    private newKernel(width: number, height: number): cv.Mat {
        const kernel = cv.getStructuringElement(cv.MORPH_RECT, this.newSize(width, height));
        this.ctx.addDeletable(kernel);
        return kernel;
    }

    public newScalar(r: number, g: number, b: number, o?: number): cv.Scalar {
        if (o === undefined) return new cv.Scalar(r, g, b);
        else return new cv.Scalar(r, g, b, o);
    }

    public newSize(width: number, height: number): cv.Size {
        return new cv.Size(width, height);
    }

    public newPoint(x: number, y: number): cv.Point {
        return new cv.Point(x, y);
    }

    public async toBuffer(format?: ImageFormat): Promise<ArrayBuffer> {
        return await Util.matToBuffer(this.mat, { format });
    }

    public async toBase64(format?: ImageFormat): Promise<string> {
        const buf = await this.toBuffer(format);
        return this.ocr.platform.base64.encode(buf);
    }

    public clone(name?: string): Image {
        name = name || this.name;
        return new Image(name, this.ctx.cloneMat(this.mat), this.ocr, this.ctx);
    }

    public getPersistentCopy(): Image {
        const mat = this.mat.clone();
        return new Image(this.name, mat, this.ocr, this.ctx);
    }

    private assertFraction(fraction: number, field: string) {
        if (fraction < 0 || fraction > 1) {
            throw new Error(`Expecting ${field} to be between [0,1] but found ${fraction}`);
        }
    }

    public toJSON(): Object {
        return { name: this.name };
    }

    public async serialize(format: ImageFormat, base64Encode: boolean): Promise<NamedImageInfo> {
        const size = this.mat.size();
        const buffer = base64Encode ? await this.toBase64(format) : await this.toBuffer(format);
        return { name: this.name, format, buffer, width: size.width, height: size.height };
    }

}

export class Images {

    private images: Image[] = [];

    constructor() {
    }

    public add(image: Image) {
        this.images.push(image);
    }

    public isEmpty(): boolean {
        return this.images.length == 0;
    }

    public async serialize(format: ImageFormat, base64Encode: boolean): Promise<NamedImageInfo[] | undefined> {
        if (this.isEmpty()) return undefined;
        const rtn: NamedImageInfo[] = [];
        for (const image of this.images) {
            rtn.push(await image.serialize(format, base64Encode));
        }
        return rtn;
    }
}
