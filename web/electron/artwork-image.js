'use strict';

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

let jxlCodecsPromise;

function jxlCodecs() {
  if (!jxlCodecsPromise) {
    jxlCodecsPromise = Promise.all([
      import('@jsquash/jxl/encode.js'),
      import('@jsquash/jxl/decode.js')
    ]).then(async ([encoder, decoder]) => {
      const packageRoot = path.dirname(require.resolve('@jsquash/jxl/package.json'));
      await Promise.all([
        encoder.init({ wasmBinary: fs.readFileSync(path.join(packageRoot, 'codec', 'enc', 'jxl_enc.wasm')) }),
        decoder.init({ wasmBinary: fs.readFileSync(path.join(packageRoot, 'codec', 'dec', 'jxl_dec.wasm')) })
      ]);
      return { encode: encoder.default, decode: decoder.default };
    });
  }
  return jxlCodecsPromise;
}

function isJxl(bytes) {
  return bytes?.length >= 2 && (
    (bytes[0] === 0xff && bytes[1] === 0x0a) ||
    (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'JXL ')
  );
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function imagePipeline(bytes) {
  if (isJxl(bytes)) {
    const { decode } = await jxlCodecs();
    const decoded = await decode(toArrayBuffer(bytes));
    const pixels = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
    return sharp(pixels, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
      limitInputPixels: 40_000_000
    });
  }

  return sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate();
}

async function squarePixels(bytes, maximumSide = 1024, allowUpscale = false) {
  const pipeline = await imagePipeline(Buffer.from(bytes || []));
  let result = await pipeline
    .resize(maximumSide, maximumSide, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: !allowUpscale
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const side = Math.min(result.info.width, result.info.height);
  if (result.info.width !== side || result.info.height !== side) {
    const left = Math.floor((result.info.width - side) / 2);
    const top = Math.floor((result.info.height - side) / 2);
    result = await sharp(result.data, {
      raw: { width: result.info.width, height: result.info.height, channels: 4 }
    }).extract({ left, top, width: side, height: side }).raw().toBuffer({ resolveWithObject: true });
  }

  return { data: result.data, width: result.info.width, height: result.info.height };
}

async function encodeSquareJxl(pixels, quality = 90) {
  const { encode } = await jxlCodecs();
  const imageData = {
    width: pixels.width,
    height: pixels.height,
    data: new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength)
  };
  const encoded = await encode(imageData, { quality });
  return Buffer.from(encoded);
}

async function createSquareJxl(bytes, maximumSide = 1024) {
  const pixels = await squarePixels(bytes, maximumSide);
  return {
    buffer: await encodeSquareJxl(pixels),
    width: pixels.width,
    height: pixels.height
  };
}

async function createSquarePng(bytes, maximumSide = 512) {
  const pixels = await squarePixels(bytes, maximumSide, true);
  return sharp(pixels.data, {
    raw: { width: pixels.width, height: pixels.height, channels: 4 }
  }).png().toBuffer();
}

module.exports = { createSquareJxl, createSquarePng, isJxl };
