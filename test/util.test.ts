/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { Util, cv } from "..";

describe('All', () => {
    test('fractionIntersects', () => {
        expect(Util.fractionIntersects({min:0,max:100},{min:50,max:150})).toBe(0.5);
    });
    test('xDistance', () => {
        expect(Util.xDistance(new cv.Rect(26,33,15,8),new cv.Rect(105,28,9,10))).toBe(64);
    });

});
