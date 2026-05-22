"use client";

const PLAN_METADATA_KEY = "gtnh-factory-flow-project";
export const FLOW_IMAGE_EXPORT_EVENT = "gtnh-flow-export-image";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function embedProjectJsonInSvg(svgText: string, projectJson: string): string {
  const metadata = `<metadata id="${PLAN_METADATA_KEY}">${encodeText(projectJson)}</metadata>`;
  return svgText.replace(/<svg\b[^>]*>/, (openingTag) => `${openingTag}${metadata}`);
}

export function extractProjectJsonFromSvg(svgText: string): string | undefined {
  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const metadata = document.querySelector(`metadata#${cssEscape(PLAN_METADATA_KEY)}`);
  const encodedProject = metadata?.textContent?.trim();
  return encodedProject ? decodeText(encodedProject) : undefined;
}

export async function embedProjectJsonInPng(pngBlob: Blob, projectJson: string): Promise<Blob> {
  const bytes = new Uint8Array(await pngBlob.arrayBuffer());
  validatePng(bytes);

  const iendOffset = findPngChunkOffset(bytes, "IEND");
  const textPayload = concatBytes(
    TEXT_ENCODER.encode(PLAN_METADATA_KEY),
    new Uint8Array([0]),
    TEXT_ENCODER.encode(encodeText(projectJson)),
  );
  const textChunk = createPngChunk("tEXt", textPayload);

  return new Blob(
    [
      toArrayBuffer(bytes.slice(0, iendOffset)),
      toArrayBuffer(textChunk),
      toArrayBuffer(bytes.slice(iendOffset)),
    ],
    {
      type: "image/png",
    },
  );
}

export async function extractProjectJsonFromPng(file: Blob): Promise<string | undefined> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  validatePng(bytes);

  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > bytes.length) {
      throw new Error("Invalid PNG chunk.");
    }

    if (type === "tEXt") {
      const separatorIndex = bytes.indexOf(0, dataStart);
      if (separatorIndex > dataStart && separatorIndex < dataEnd) {
        const keyword = TEXT_DECODER.decode(bytes.slice(dataStart, separatorIndex));
        if (keyword === PLAN_METADATA_KEY) {
          return decodeText(TEXT_DECODER.decode(bytes.slice(separatorIndex + 1, dataEnd)));
        }
      }
    }

    if (type === "IEND") {
      return undefined;
    }

    offset = dataEnd + 4;
  }

  return undefined;
}

export function dataUrlToText(dataUrl: string): string {
  const [header, payload] = dataUrl.split(",", 2);
  if (!header || payload === undefined) {
    throw new Error("Invalid image data URL.");
  }

  if (header.endsWith(";base64")) {
    return decodeText(payload);
  }

  return decodeURIComponent(payload);
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

function encodeText(value: string): string {
  const bytes = TEXT_ENCODER.encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeText(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return TEXT_DECODER.decode(bytes);
}

function validatePng(bytes: Uint8Array) {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error("Invalid PNG file.");
  }
}

function findPngChunkOffset(bytes: Uint8Array, chunkType: string): number {
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    const dataEnd = offset + 8 + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error("Invalid PNG chunk.");
    }

    if (type === chunkType) {
      return offset;
    }

    offset = dataEnd + 4;
  }

  throw new Error(`PNG chunk ${chunkType} not found.`);
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = TEXT_ENCODER.encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(concatBytes(typeBytes, data)));
  return chunk;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((total, array) => total + array.length, 0));
  let offset = 0;
  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });
  return result;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}
