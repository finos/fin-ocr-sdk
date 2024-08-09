/**
 * Copyright (c) 2024 Discover Financial Services
*/
import { cv } from "./ocv.js";

export class Color {

    public static red = new cv.Scalar(255, 0, 0);
    public static green = new cv.Scalar(0, 255, 0);
    public static darkBlue = new cv.Scalar(0, 0, 255);
    public static lightBlue = new cv.Scalar(0, 255, 255);
    public static black = new cv.Scalar(0, 0, 0);
    public static white = new cv.Scalar(255, 255, 255);
    public static yellow = new cv.Scalar(255, 255, 0);
    public static pink = new cv.Scalar(255, 0, 255);

}
