/**
 * AWS event stream (application/vnd.amazon.eventstream) decoding, used by Bedrock's
 * streaming APIs. Each message is binary:
 *
 *   total length (4) | headers length (4) | prelude CRC32 (4) | headers | payload | message CRC32 (4)
 *
 * https://docs.aws.amazon.com/transcribe/latest/dg/streaming-setting-up.html#streaming-event-stream
 */

export type EventStreamHeaderValue = string | number | boolean | bigint | Uint8Array | Date;

export interface EventStreamMessage {
  headers: Record<string, EventStreamHeaderValue>;
  payload: Uint8Array;
}

const PRELUDE_LENGTH = 12;
const MAX_MESSAGE_LENGTH = 16 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE), as the event stream format uses */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Decodes one complete message */
export function decodeEventStreamMessage(bytes: Uint8Array): EventStreamMessage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < PRELUDE_LENGTH + 4) throw new Error('Event stream message is too short');

  const totalLength = view.getUint32(0);
  const headersLength = view.getUint32(4);
  if (totalLength !== bytes.byteLength) throw new Error('Event stream message length mismatch');
  if (view.getUint32(8) !== crc32(bytes.subarray(0, 8))) throw new Error('Event stream prelude checksum mismatch');
  if (view.getUint32(totalLength - 4) !== crc32(bytes.subarray(0, totalLength - 4))) {
    throw new Error('Event stream message checksum mismatch');
  }

  const headers: Record<string, EventStreamHeaderValue> = {};
  const decoder = new TextDecoder();
  let offset = PRELUDE_LENGTH;
  const headersEnd = PRELUDE_LENGTH + headersLength;
  while (offset < headersEnd) {
    const nameLength = view.getUint8(offset);
    offset += 1;
    const name = decoder.decode(bytes.subarray(offset, offset + nameLength));
    offset += nameLength;
    const type = view.getUint8(offset);
    offset += 1;
    switch (type) {
      case 0: headers[name] = true; break;
      case 1: headers[name] = false; break;
      case 2: headers[name] = view.getInt8(offset); offset += 1; break;
      case 3: headers[name] = view.getInt16(offset); offset += 2; break;
      case 4: headers[name] = view.getInt32(offset); offset += 4; break;
      case 5: headers[name] = view.getBigInt64(offset); offset += 8; break;
      case 6:
      case 7: {
        const length = view.getUint16(offset);
        offset += 2;
        const value = bytes.subarray(offset, offset + length);
        headers[name] = type === 7 ? decoder.decode(value) : value.slice();
        offset += length;
        break;
      }
      case 8: headers[name] = new Date(Number(view.getBigInt64(offset))); offset += 8; break;
      case 9: headers[name] = bytes.slice(offset, offset + 16); offset += 16; break;
      default: throw new Error(`Unknown event stream header type ${type}`);
    }
  }

  return { headers, payload: bytes.slice(headersEnd, totalLength - 4) };
}

/** Encodes a message with string headers (for tests and fakes) */
export function encodeEventStreamMessage(headers: Record<string, string>, payload: Uint8Array | string): Uint8Array {
  const encoder = new TextEncoder();
  const body = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const headerBytes: number[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const n = encoder.encode(name);
    const v = encoder.encode(value);
    headerBytes.push(n.length, ...n, 7, (v.length >> 8) & 0xff, v.length & 0xff, ...v);
  }
  const totalLength = PRELUDE_LENGTH + headerBytes.length + body.length + 4;
  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, totalLength);
  view.setUint32(4, headerBytes.length);
  view.setUint32(8, crc32(out.subarray(0, 8)));
  out.set(headerBytes, PRELUDE_LENGTH);
  out.set(body, PRELUDE_LENGTH + headerBytes.length);
  view.setUint32(totalLength - 4, crc32(out.subarray(0, totalLength - 4)));
  return out;
}

/** Reads messages from an event stream response body as they arrive */
export async function* readEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<EventStreamMessage> {
  const reader = body.getReader();
  let buffer: Uint8Array = new Uint8Array(0);
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      buffer = concat(buffer, value);
      while (buffer.byteLength >= 4) {
        const totalLength = new DataView(buffer.buffer, buffer.byteOffset, 4).getUint32(0);
        if (totalLength < PRELUDE_LENGTH + 4 || totalLength > MAX_MESSAGE_LENGTH) {
          throw new Error(`Invalid event stream message length ${totalLength}`);
        }
        if (buffer.byteLength < totalLength) break;
        yield decodeEventStreamMessage(buffer.subarray(0, totalLength));
        buffer = buffer.subarray(totalLength);
      }
    }
    if (buffer.byteLength > 0) throw new Error('Event stream ended in the middle of a message');
  } finally {
    // The consumer may stop early; release the connection
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.byteLength === 0) return b;
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a);
  out.set(b, a.byteLength);
  return out;
}
