import { gunzipSync, gzipSync } from 'node:zlib';
import type { VolcanoEndpoint, VolcanoRuntimeConfig } from './volcano-config';

export interface VolcanoFrameOptions {
  useGzip?: boolean;
}

export interface ParsedVolcanoServerFrame {
  messageType: number;
  flags: number;
  serialization: number;
  compression: number;
  sequence: number | null;
  payloadSize: number;
  payloadBytes: Uint8Array;
  payloadJson?: any;
}

function createHeader(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number
): Uint8Array {
  return new Uint8Array([
    0x11,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ]);
}

function withSizePrefix(header: Uint8Array, payload: Uint8Array, sequence?: number): Uint8Array {
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, payload.length, false);

  const totalLength = header.length + (sequence == null ? 0 : 4) + size.length + payload.length;
  const frame = new Uint8Array(totalLength);
  let offset = 0;

  frame.set(header, offset);
  offset += header.length;

  if (sequence != null) {
    new DataView(frame.buffer).setInt32(offset, sequence, false);
    offset += 4;
  }

  frame.set(size, offset);
  offset += size.length;
  frame.set(payload, offset);
  return frame;
}

function maybeGzip(payload: Uint8Array, useGzip: boolean): Uint8Array {
  if (!useGzip) return payload;
  return new Uint8Array(gzipSync(Buffer.from(payload)));
}

export function buildVolcanoRequestObject(config: VolcanoRuntimeConfig): Record<string, unknown> {
  const audio: Record<string, unknown> = {
    format: 'pcm',
    codec: 'raw',
    rate: 16000,
    bits: 16,
    channel: 1,
  };

  if (config.endpoint === 'bigmodel_nostream' && config.language) {
    audio.language = config.language;
  }

  return {
    user: { uid: crypto.randomUUID() },
    audio,
    request: config.request,
  };
}

export function buildVolcanoRequestFrame(
  payload: Record<string, unknown>,
  options: VolcanoFrameOptions = {}
): Uint8Array {
  const useGzip = options.useGzip ?? true;
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = maybeGzip(raw, useGzip);
  return withSizePrefix(createHeader(1, 0, 1, useGzip ? 1 : 0), compressed);
}

export function buildVolcanoAudioFrame(
  audioBytes: Uint8Array,
  options: VolcanoFrameOptions & { isLast?: boolean } = {}
): Uint8Array {
  const useGzip = options.useGzip ?? true;
  const payload = maybeGzip(audioBytes, useGzip);
  const flags = options.isLast ? 0x02 : 0x00;
  return withSizePrefix(createHeader(2, flags, 0, useGzip ? 1 : 0), payload);
}

export function parseVolcanoServerFrame(frame: Uint8Array): ParsedVolcanoServerFrame {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const byte1 = view.getUint8(1);
  const byte2 = view.getUint8(2);
  const flags = byte1 & 0x0f;
  const hasSequence = flags === 0x01 || flags === 0x03;

  let offset = 4;
  let sequence: number | null = null;
  if (hasSequence) {
    sequence = view.getInt32(offset, false);
    offset += 4;
  }

  const payloadSize = view.getUint32(offset, false);
  offset += 4;

  const payloadBytes = frame.slice(offset, offset + payloadSize);
  const compression = byte2 & 0x0f;
  const serialization = byte2 >> 4;
  const decodedPayload =
    compression === 1
      ? new Uint8Array(gunzipSync(Buffer.from(payloadBytes)))
      : payloadBytes;

  let payloadJson: any;
  if (serialization === 1) {
    payloadJson = JSON.parse(new TextDecoder().decode(decodedPayload));
  }

  return {
    messageType: byte1 >> 4,
    flags,
    serialization,
    compression,
    sequence,
    payloadSize,
    payloadBytes: decodedPayload,
    payloadJson,
  };
}

export function isVolcanoFinalResponse(
  frame: ParsedVolcanoServerFrame,
  endpoint: VolcanoEndpoint
): boolean {
  if (frame.messageType === 15) return true;
  if (endpoint === 'bigmodel_async') {
    return frame.flags === 0x03;
  }
  return Boolean(frame.payloadJson?.audio_info);
}
