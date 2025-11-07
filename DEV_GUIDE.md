# Developers Guide

This document serves as a getting started guide for those wanting to build or modify the code for fin-ocr-sdk.

- [Getting Started](#getting-started) 
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Scans](#scans)
- [Links](#links)

## Getting Started

#### 1. Build the SDK Locally:

In order to modify the sdk and test your changes, you will need to clone the repository and build it locally:

```bash
git clone https://github.com/finos/fin-ocr-sdk.git
cd fin-ocr-sdk
npm run build
```

#### 2. Link the SDK Globally:
To use this locally built SDK in another project, it must be "linked", this makes the SDK available to other projects:

```bash
npm link
```
After this step, navigate to your project where you want to use the SDK and link it:
e.g.
```bash
cd your-project
npm link @finos/fin-ocr-sdk
```
You can now import and use the SDK in your project just as you would with any npm package.

### Design

This SDK is designed to be browser and mobile friendly.

It uses the following open source projects:

* `opencv.js` to perform various image pre-processing operations such as locating special symbols on an image, cropping and cleaning an image, etc;

* `tesseract.js` to translate text on a (preferably clean) image.

## Roadmap

1. Deploy SDK to npm

## Contributing

This document provides guidance for how YOU can collaborate with our project community to improve this technology.

[FIN-OCR Contribution](https://github.com/finos/fin-ocr/blob/main/CONTRIBUTE.md)

## Scans
### Vulnerability Report

To generate a report containing any vulnerabilities in any dependency please use:

```bash
$npm run scan
```

### License Report

```bash
npm run scan-license
```

**Note:** Each of these scans should be run and problems addressed by a developer prior to submitting code that uses new packages.


## Links

- [Release Notes](./RELEASE_NOTES.md)
