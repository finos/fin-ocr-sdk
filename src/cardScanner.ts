/**
 * Copyright (c) 2024 Capital One
*/
import { Platform, NewImageOpts } from "./ocr.js";
import { ImageFormat  } from "./image.js";
import { Context } from "./context.js";
import { ConfigOpts } from "./config.js";
import { Scanner } from "./scanner.js"; 

/**
 ** Card scanner
 */
export class CardScanner {

    public static async new(platform: Platform, config?: ConfigOpts): Promise<CardScanner> {
        const scanner = await Scanner.new({
            name: "Card Scanner",
            settings: {
                platform,
                translators: {
                    opencv: {
                        refImage: "ocr_a_digits.png",
                        format: ImageFormat.PNG,
                        charDescriptors: ["0","1","2","3","4","5","6","7","8","9"],
                    }
                },
                config,
            },
            actions: [
                {type: "gray"},
                {type: "deskew"},
            ],
        });
        return new CardScanner(scanner);
    }

    private scanner: Scanner;

    constructor(scanner: Scanner) {
        this.scanner = scanner;
    }

    public async scan(buf: ArrayBuffer, ctx: Context, opts?: NewImageOpts): Promise<any> {
        return this.scanner.scan(buf, ctx, opts);
    }

}
