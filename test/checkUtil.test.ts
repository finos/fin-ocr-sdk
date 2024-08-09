/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { CheckUtil, Context } from "..";

describe('MicrParserTests', () => {
    test('gci1', () => {
        gciTest("","","");
    });
    test('gci2', () => {
        gciTest("123","456","789","T123T456U789");
    });
    test('gci3', () => {
        gciTest("34","56","12","U12U T34T 56");
    });
    test('gci4', () => {
        gciTest("34","56","12","U12U T34T U56U A78A");
    });
    test('gci5', () => {
        gciTest("12","34","56","TT12T34U56")
    });
    test('gci5', () => {
        gciTest("012","034","56","T012T034U056")
    });
});

function gciTest(routingNumber: string, accountNumber: string, checkNumber: string, micrLine?: string) {
    let ci = CheckUtil.micrToCheckInfo("test", Context.obtain("test"), micrLine);
    micrLine = micrLine || "";
    expect(ci.micrLine).toBe(micrLine );
    expect(ci.routingNumber).toBe(routingNumber);
    expect(ci.accountNumber).toBe(accountNumber);
    expect(ci.checkNumber).toBe(checkNumber);
}
