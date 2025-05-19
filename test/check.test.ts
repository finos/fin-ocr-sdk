/**
 * Copyright (c) 2024 Capital One
*/
import * as fs from 'fs';
import * as ocr from "..";

describe('CheckTests', () => {
    test('scan', async () => {
        //await scan("test/check13.png",ocr.ImageFormat.PNG,"");
    });
});

async function scan(fileName: string, format: ocr.ImageFormat, result: string) {
    const buffer = fs.readFileSync(fileName);
    const cm = await ocr.CheckMgr.setInstance({platform: platform, config: {translators:"opencv",logLevel:"info"}});
    let micrLine: any;
    try {
        const result = await cm.scan({id: fileName, image: {buffer,format}});
        micrLine = result.translators.opencv?.result.micrLine;
    } finally {
        await cm.stop();
        expect(micrLine).toBe("U0024154UT031100649T4400000084U");
    }
}

export const platform: ocr.Platform = {
    base64: {
        encode: function(buf: ArrayBuffer): string {
            return (buf as Buffer).toString("base64");
        },
        decode: function(str: string): ArrayBuffer {
            return Buffer.from(str, 'base64');
        }
    }
}
