[![DFS - Incubating](./_images/discover-incubating.svg)](https://technology.discover.com/technologies/open_source) [![Contributors-Invited](https://img.shields.io/badge/Contributors-Wanted-blue)](./CONTRIBUTE.md)
# FIN OCR SDK

This package is a browser and mobile-friendly SDK which provides typescript programmatic APIs to perform OCR (Optical Character Recognition).

> **NOTE:** This SDK is not yet published to npm. It must be cloned and built locally until it is published.

The initial use case supports OCR of bank checks in order to return the routing, account, and check number fields; however, it is designed to support other use cases in the future.

## Getting Started

#### 1. Build the SDK Locally:

Since the SDK is not yet available on npm, you need to clone the repository and build it locally:

```bash
git clone https://github.com/discoverfinancial/fin-ocr-sdk.git
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
npm link @discoverfinancial/fin-ocr-sdk
```
You can now import and use the SDK in your project just as you would with any npm package.

### Sample code

The following is a sample code snippet demonstrating how to use this SDK to OCR a bank check.

```
import * as ocr from "@discoverfinancial/fin-ocr-sdk";
import * as fs from 'fs';

// Scan a check image contained in 'file' of TIFF format
async function scanCheck(file: string) {
    // Initialize the check manager, allowing
    // configuration via environment variables.
    const checkMgr = await ocr.CheckMgr.getInstanceByEnv(process.env);
    // Read from a file and scan the image.
    // This is called once per check.
    const b64 = fs.readFileSync(file).toString("base64");
    const result = await checkMgr.scan({
        id: "1",
        image: {
            format: "tiff",
            buffer: b64
        }
    });
    console.log(JSON.stringify(result,null,4));
    // When done scanning all checks, stop the check manager
    await checkMgr.stop();
}
```

##### How to configure

The following environment variables may be used to configure the SDK.

| Name | Default | Description |
| ---- | ------- | ----------- |
| OCR_LOG_LEVEL | "info" | The log level which is any of the following: "fatal", "error", "warn", "info", "debug", "trace", or "verbose". |
| OCR_SLOW_REQUEST_MS | 0 | If greater than 0, enable slow request detection.  If a request takes longer than this many milliseconds, a warning message is logged at level `OCR_SLOW_OR_HUNG_REQUEST_LOG_LEVEL` when the request completes. |
| OCR_HUNG_REQUEST_MS | 0 | If greater than 0, enable hung request detection.  If a request takes longer than this many milliseconds, a warning message is logged at level `OCR_SLOW_OR_HUNG_REQUEST_LOG_LEVEL`, even if the request has not completed. |
| OCR_SLOW_OR_HUNG_REQUEST_LOG_LEVEL | "debug" | The log level for slow or hung requests. The value may be any of the following: "fatal", "error", "warn", "info", "debug", "trace", or "verbose". |
| OCR_OVERLAP_CORRECTION | true | Set to false to disable OCR overlap correction. |

The src/config.ts file contains a complete list of configuration variables.  Each variable is configuable programatically or via an environment variable.

### Design

This SDK is designed to be browser and mobile friendly.

It uses the following open source projects:

* `opencv.js` to perform various image pre-processing operations such as locating special symbols on an image, cropping and cleaning an image, etc;

* `tesseract.js` to translate text on a (preferrably clean) image.

### Links

- [Release Notes](./RELEASE_NOTES.md)
