/**
 * Copyright (c) 2024 Capital One
 */

let Jimp: typeof import('jimp');

const loadJimp = async (): Promise<typeof import('jimp')> => {
    if (typeof window !== 'undefined') {
        if (!window.Jimp) {
            return new Promise<typeof import('jimp')>((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jimp/0.22.12/jimp.min.js';
                script.onload = () => {
                    Jimp = window.Jimp;
                    resolve(Jimp);
                };
                script.onerror = reject;
                document.head.appendChild(script);
            });
        } else {
            Jimp = window.Jimp;
            return Jimp;
        }
    } else {
        const jimpModule = await import('jimp');
        Jimp = jimpModule.default;
        return Jimp;
    }
};

export { Jimp, loadJimp };
