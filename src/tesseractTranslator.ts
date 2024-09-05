/**
 * Copyright (c) 2024 Discover Financial Services
 */
import Tesseract from "tesseract.js";
import {
  Translator,
  TranslatorResult,
  TranslatorChar,
  TranslatorChoice,
  TranslatorOpts,
} from "./translators.js";
import { Image, ImageFormat } from "./image.js";
import { Context } from "./context.js";
import { OCR } from "./ocr.js";
import { Line } from "./line.js";
import { isNode } from "./runtimeInfo.js";

export interface TesseractTranslatorInitArgs {
  font: string;
  pageSegmentationMode: string;
}

const { createWorker, PSM } = Tesseract;

interface Choice {
  text: string;
  confidence: number;
}

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Symbol {
  choices: Choice[];
  text: string;
  confidence: number;
  bbox: BBox;
}

/**
 * TesseractTranslator initializes and calls tesseract to perform translation of a line.
 */
export class TesseractTranslator implements Translator {
  public readonly ocr: OCR;
  public readonly name = "tesseract";
  private workers: Tesseract.Worker[] = [];
  private workerCount = 0;
  private font = "eng";
  private psm: any;
  private trainedDatas: { font: string; trainedData: string }[] = [];
  private tessdataPath?: string;

  public constructor(ocr: OCR) {
    this.ocr = ocr;
    this.tessdataPath = isNode() && process.env.TESSDATA_PREFIX ? process.env.TESSDATA_PREFIX : ".";
  }

  public async init(args: TesseractTranslatorInitArgs, ctx: Context) {
    ctx.info(`Initializing tesseract: ${JSON.stringify(args)}`);
    this.font = args.font || this.font;
    this.setPSM(args.pageSegmentationMode);
    // NOTE: The traineddata files for the supported fonts are bundled with the SDK.
    // However, I have not been able to get tesseract to recognize those loaded with the "worker.writeText" in the "getWorker" function below.
    //this.initFonts();
  }

  private initFonts() {
    const fonts = this.font.split("+");
    for (const font of fonts) {
      const trainedData = this.ocr.root
        .readFile(`${font}.traineddata`)
        .toString();
      this.trainedDatas.push({ font, trainedData });
    }
  }

  public setPSM(psm: string) {
    for (const val of Object.values(PSM)) {
      if (psm === val) {
        this.psm = psm;
        return;
      }
    }
    throw new Error(`${psm} is not a valid value for OCR_PSM`);
  }

  public async translate(
    line: Line,
    opts?: TranslatorOpts,
  ): Promise<TranslatorResult> {
    let img = line.toImage({ name: "tesseract-input" });
    if (this.ocr.cfg.tesseractBlackOnWhite) {
      img = img.bitwiseNot({ name: "tesseract-input" });
    }
    if (img.ctx.debugImages) img.display();
    return await this.translateImage(img, opts);
  }

  public async translateImage(
    img: Image,
    opts?: TranslatorOpts,
  ): Promise<TranslatorResult> {
    const ctx = img.ctx;
    opts = opts || {};
    const debug = opts.debug || false;
    const buf = await img.toBuffer(ImageFormat.TIF);
    const worker = await this.obtainWorker(ctx);
    if (ctx.isDebugEnabled()) ctx.debug(`Calling tesseract`);
    const result = await worker.recognize(buf as any);
    const data = result.data;
    const value = data.text || "";
    const score = data.confidence;
    const chars: TranslatorChar[] = debug
      ? this.toChars(data.symbols, img, ctx)
      : [];
    this.releaseWorker(worker);
    if (ctx.isDebugEnabled())
      ctx.debug(`tesseract result: score=${score}, value=${value}`);
    return { value, score, chars };
  }

  public async start(ctx: Context) {
    const worker = await this.obtainWorker(ctx);
    this.releaseWorker(worker);
  }

  public async stop(ctx: Context) {
    await this.terminateWorkers(ctx);
  }

  private async obtainWorker(ctx: Context): Promise<Tesseract.Worker> {
    const self = this;
    if (this.workers.length > 0) {
      const worker = this.workers.pop() as Tesseract.Worker;
      if (ctx.isDebugEnabled()) ctx.debug(`Got buffered tesseract worker`);
      return worker;
    }
    const count = ++this.workerCount;
    if (ctx.isDebugEnabled()) ctx.debug(`Creating tesseract worker ${count}`);
    const workerOptions: any = {};
    workerOptions.langPath = this.tessdataPath;
    const worker = await createWorker(workerOptions);
    for (const ele of self.trainedDatas) {
      await worker.writeText(`${ele.font}.traineddata`, ele.trainedData);
    }
    await worker.loadLanguage(self.font);
    await worker.initialize(self.font);
    await worker.setParameters({ tessedit_pageseg_mode: self.psm });
    if (ctx.isDebugEnabled()) ctx.debug(`Created tesseract worker ${count}`);
    return worker;
  }

  private releaseWorker(worker: Tesseract.Worker) {
    this.workers.push(worker);
  }

  private async terminateWorkers(ctx: Context) {
    if (ctx.isDebugEnabled())
      ctx.debug(`Terminating ${this.workers.length} tesseract workers`);
    for (;;) {
      const worker = this.workers.pop();
      if (!worker) break;
      await worker.terminate();
    }
    if (ctx.isDebugEnabled())
      ctx.debug(`Terminated ${this.workers.length} tesseract workers`);
  }

  private toChars(
    symbols: Symbol[],
    inputImage: Image,
    ctx: Context,
  ): TranslatorChar[] {
    if (ctx.isDebugEnabled())
      ctx.debug(
        `toChars enter: ${symbols.length} symbols, image size: ${JSON.stringify(inputImage.mat.size())}`,
      );
    const chars: TranslatorChar[] = [];
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i] as Symbol;
      const choices: TranslatorChoice[] = [];
      choices.push({
        value: symbol.text,
        score: Math.round(symbol.confidence),
      });
      for (const choice of symbol.choices) {
        if (symbol.text !== choice.text) {
          choices.push({
            value: choice.text,
            score: Math.round(choice.confidence),
          });
        }
      }
      // NOTE: The commented out logic below attempts to return the ROI for each character within the image.  However, it does
      //       not appear to be accurate and is more confusing and distracting than helpful when viewing; therefore, it is commented out currently.
      //       It seems either there is something wrong with this logic for finding the character's coordinates within the image,
      //       or perhaps they are the coordinates of an intermediate image that is generated by tesseract from the original image.
      //       Either way, this means that from a debugging perspective, we can not view the character segmentation performed by tesseract
      //       during translation.  We simply know the final translation result and the confidence level for each character.
      //const b = symbol.bbox;
      //const image = inputImage.roi(`tesseract-char-${i}`, new cv.Rect(b.x0, b.y0, b.x1-b.x0, b.y1-b.y0));
      //chars.push(new TranslatorChar(choices, { image }));
      chars.push(new TranslatorChar(choices));
    }
    return chars;
  }
}
