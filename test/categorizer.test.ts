/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { cv, Categorizer, Category, ZScoreCategorizer } from "..";

describe('Categorizer', () => {
    test('small', () => {
        testIt(1,Category.Small);
    });
    test('medium', () => {
        testIt(5,Category.Medium);
    });
    test('large', () => {
        testIt(10,Category.Large);
    });
});

function testIt(num: number, rtn: Category) {
    const c = new ZScoreCategorizer([1,5,6,5,6,5,6,5,6,5,6,10]);
    const r = c.getCategory(num);
    expect(r).toBe(rtn);
}
