/**
 * Pure JavaScript MessagePack Encoder and Decoder with Neovim Extension Support
 * Zero external dependencies. Manifest V3 compliant.
 */

(() => {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  // Neovim Extension Types
  class NvimExt {
    constructor(type, id) {
      this.type = type; // 0: Buffer, 1: Window, 2: Tabpage
      this.id = id;
    }
  }

  const Msgpack = {
    NvimExt,

    /**
     * Encodes a JS value into a Uint8Array MessagePack buffer.
     */
    encode(val) {
      const parts = [];
      encodeValue(val, parts);
      let totalLen = 0;
      for (let i = 0; i < parts.length; i++) totalLen += parts[i].length;
      const out = new Uint8Array(totalLen);
      let offset = 0;
      for (let i = 0; i < parts.length; i++) {
        out.set(parts[i], offset);
        offset += parts[i].length;
      }
      return out;
    },

    /**
     * Decodes all complete MessagePack messages from a Uint8Array.
     * Returns { messages: any[], consumed: number }.
     */
    decodeMultiple(buf) {
      const messages = [];
      let offset = 0;
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

      while (offset < buf.length) {
        const start = offset;
        try {
          const { value, nextOffset } = decodeValue(buf, view, offset);
          messages.push(value);
          offset = nextOffset;
        } catch (e) {
          if (e.incomplete) {
            // Reached partial message, stop and return consumed bytes
            return { messages, consumed: start };
          }
          throw e;
        }
      }
      return { messages, consumed: offset };
    }
  };

  function encodeValue(val, parts) {
    if (val === null || val === undefined) {
      parts.push(new Uint8Array([0xc0])); // nil
      return;
    }
    if (typeof val === 'boolean') {
      parts.push(new Uint8Array([val ? 0xc3 : 0xc2]));
      return;
    }
    if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        if (val >= 0) {
          if (val <= 0x7f) {
            parts.push(new Uint8Array([val])); // positive fixint
          } else if (val <= 0xff) {
            parts.push(new Uint8Array([0xcc, val]));
          } else if (val <= 0xffff) {
            const b = new Uint8Array(3);
            b[0] = 0xcd;
            new DataView(b.buffer).setUint16(1, val, false);
            parts.push(b);
          } else if (val <= 0xffffffff) {
            const b = new Uint8Array(5);
            b[0] = 0xce;
            new DataView(b.buffer).setUint32(1, val, false);
            parts.push(b);
          } else {
            const b = new Uint8Array(9);
            b[0] = 0xcf;
            new DataView(b.buffer).setBigUint64(1, BigInt(val), false);
            parts.push(b);
          }
        } else {
          if (val >= -32) {
            parts.push(new Uint8Array([val & 0xff])); // negative fixint
          } else if (val >= -128) {
            parts.push(new Uint8Array([0xd0, val & 0xff]));
          } else if (val >= -32768) {
            const b = new Uint8Array(3);
            b[0] = 0xd1;
            new DataView(b.buffer).setInt16(1, val, false);
            parts.push(b);
          } else if (val >= -2147483648) {
            const b = new Uint8Array(5);
            b[0] = 0xd2;
            new DataView(b.buffer).setInt32(1, val, false);
            parts.push(b);
          } else {
            const b = new Uint8Array(9);
            b[0] = 0xd3;
            new DataView(b.buffer).setBigInt64(1, BigInt(val), false);
            parts.push(b);
          }
        }
      } else {
        // float64
        const b = new Uint8Array(9);
        b[0] = 0xcb;
        new DataView(b.buffer).setFloat64(1, val, false);
        parts.push(b);
      }
      return;
    }
    if (typeof val === 'string') {
      const strBytes = textEncoder.encode(val);
      const len = strBytes.length;
      if (len <= 31) {
        parts.push(new Uint8Array([0xa0 | len]));
      } else if (len <= 0xff) {
        parts.push(new Uint8Array([0xd9, len]));
      } else if (len <= 0xffff) {
        const b = new Uint8Array(3);
        b[0] = 0xda;
        new DataView(b.buffer).setUint16(1, len, false);
        parts.push(b);
      } else {
        const b = new Uint8Array(5);
        b[0] = 0xdb;
        new DataView(b.buffer).setUint32(1, len, false);
        parts.push(b);
      }
      parts.push(strBytes);
      return;
    }
    if (val instanceof Uint8Array) {
      const len = val.length;
      if (len <= 0xff) {
        parts.push(new Uint8Array([0xc4, len]));
      } else if (len <= 0xffff) {
        const b = new Uint8Array(3);
        b[0] = 0xc5;
        new DataView(b.buffer).setUint16(1, len, false);
        parts.push(b);
      } else {
        const b = new Uint8Array(5);
        b[0] = 0xc6;
        new DataView(b.buffer).setUint32(1, len, false);
        parts.push(b);
      }
      parts.push(val);
      return;
    }
    if (val instanceof NvimExt) {
      // Fixext 1 (type, 1-byte id)
      parts.push(new Uint8Array([0xd4, val.type, val.id & 0xff]));
      return;
    }
    if (Array.isArray(val)) {
      const len = val.length;
      if (len <= 15) {
        parts.push(new Uint8Array([0x90 | len]));
      } else if (len <= 0xffff) {
        const b = new Uint8Array(3);
        b[0] = 0xdc;
        new DataView(b.buffer).setUint16(1, len, false);
        parts.push(b);
      } else {
        const b = new Uint8Array(5);
        b[0] = 0xdd;
        new DataView(b.buffer).setUint32(1, len, false);
        parts.push(b);
      }
      for (let i = 0; i < len; i++) {
        encodeValue(val[i], parts);
      }
      return;
    }
    if (typeof val === 'object') {
      const keys = Object.keys(val);
      const len = keys.length;
      if (len <= 15) {
        parts.push(new Uint8Array([0x80 | len]));
      } else if (len <= 0xffff) {
        const b = new Uint8Array(3);
        b[0] = 0xde;
        new DataView(b.buffer).setUint16(1, len, false);
        parts.push(b);
      } else {
        const b = new Uint8Array(5);
        b[0] = 0xdf;
        new DataView(b.buffer).setUint32(1, len, false);
        parts.push(b);
      }
      for (let i = 0; i < len; i++) {
        encodeValue(keys[i], parts);
        encodeValue(val[keys[i]], parts);
      }
      return;
    }
  }

  function decodeValue(buf, view, offset) {
    if (offset >= buf.length) throw { incomplete: true };
    const b = buf[offset];

    // Positive fixint: 0x00 - 0x7f
    if ((b & 0x80) === 0) {
      return { value: b, nextOffset: offset + 1 };
    }
    // Fixmap: 0x80 - 0x8f
    if ((b & 0xf0) === 0x80) {
      return decodeMap(buf, view, offset + 1, b & 0x0f);
    }
    // Fixarray: 0x90 - 0x9f
    if ((b & 0xf0) === 0x90) {
      return decodeArray(buf, view, offset + 1, b & 0x0f);
    }
    // Fixstr: 0xa0 - 0xbf
    if ((b & 0xe0) === 0xa0) {
      return decodeStr(buf, offset + 1, b & 0x1f);
    }
    // Negative fixint: 0xe0 - 0xff
    if ((b & 0xe0) === 0xe0) {
      return { value: (b << 24) >> 24, nextOffset: offset + 1 };
    }

    switch (b) {
      case 0xc0: return { value: null, nextOffset: offset + 1 };
      case 0xc2: return { value: false, nextOffset: offset + 1 };
      case 0xc3: return { value: true, nextOffset: offset + 1 };

      // bin8, bin16, bin32
      case 0xc4: {
        if (offset + 2 > buf.length) throw { incomplete: true };
        const len = buf[offset + 1];
        if (offset + 2 + len > buf.length) throw { incomplete: true };
        return { value: buf.slice(offset + 2, offset + 2 + len), nextOffset: offset + 2 + len };
      }
      case 0xc5: {
        if (offset + 3 > buf.length) throw { incomplete: true };
        const len = view.getUint16(offset + 1, false);
        if (offset + 3 + len > buf.length) throw { incomplete: true };
        return { value: buf.slice(offset + 3, offset + 3 + len), nextOffset: offset + 3 + len };
      }
      case 0xc6: {
        if (offset + 5 > buf.length) throw { incomplete: true };
        const len = view.getUint32(offset + 1, false);
        if (offset + 5 + len > buf.length) throw { incomplete: true };
        return { value: buf.slice(offset + 5, offset + 5 + len), nextOffset: offset + 5 + len };
      }

      // float32, float64
      case 0xca:
        if (offset + 5 > buf.length) throw { incomplete: true };
        return { value: view.getFloat32(offset + 1, false), nextOffset: offset + 5 };
      case 0xcb:
        if (offset + 9 > buf.length) throw { incomplete: true };
        return { value: view.getFloat64(offset + 1, false), nextOffset: offset + 9 };

      // uint8, uint16, uint32, uint64
      case 0xcc:
        if (offset + 2 > buf.length) throw { incomplete: true };
        return { value: buf[offset + 1], nextOffset: offset + 2 };
      case 0xcd:
        if (offset + 3 > buf.length) throw { incomplete: true };
        return { value: view.getUint16(offset + 1, false), nextOffset: offset + 3 };
      case 0xce:
        if (offset + 5 > buf.length) throw { incomplete: true };
        return { value: view.getUint32(offset + 1, false), nextOffset: offset + 5 };
      case 0xcf:
        if (offset + 9 > buf.length) throw { incomplete: true };
        return { value: Number(view.getBigUint64(offset + 1, false)), nextOffset: offset + 9 };

      // int8, int16, int32, int64
      case 0xd0:
        if (offset + 2 > buf.length) throw { incomplete: true };
        return { value: view.getInt8(offset + 1), nextOffset: offset + 2 };
      case 0xd1:
        if (offset + 3 > buf.length) throw { incomplete: true };
        return { value: view.getInt16(offset + 1, false), nextOffset: offset + 3 };
      case 0xd2:
        if (offset + 5 > buf.length) throw { incomplete: true };
        return { value: view.getInt32(offset + 1, false), nextOffset: offset + 5 };
      case 0xd3:
        if (offset + 9 > buf.length) throw { incomplete: true };
        return { value: Number(view.getBigInt64(offset + 1, false)), nextOffset: offset + 9 };

      // str8, str16, str32
      case 0xd9: {
        if (offset + 2 > buf.length) throw { incomplete: true };
        const len = buf[offset + 1];
        return decodeStr(buf, offset + 2, len);
      }
      case 0xda: {
        if (offset + 3 > buf.length) throw { incomplete: true };
        const len = view.getUint16(offset + 1, false);
        return decodeStr(buf, offset + 3, len);
      }
      case 0xdb: {
        if (offset + 5 > buf.length) throw { incomplete: true };
        const len = view.getUint32(offset + 1, false);
        return decodeStr(buf, offset + 5, len);
      }

      // array16, array32
      case 0xdc: {
        if (offset + 3 > buf.length) throw { incomplete: true };
        const len = view.getUint16(offset + 1, false);
        return decodeArray(buf, view, offset + 3, len);
      }
      case 0xdd: {
        if (offset + 5 > buf.length) throw { incomplete: true };
        const len = view.getUint32(offset + 1, false);
        return decodeArray(buf, view, offset + 5, len);
      }

      // map16, map32
      case 0xde: {
        if (offset + 3 > buf.length) throw { incomplete: true };
        const len = view.getUint16(offset + 1, false);
        return decodeMap(buf, view, offset + 3, len);
      }
      case 0xdf: {
        if (offset + 5 > buf.length) throw { incomplete: true };
        const len = view.getUint32(offset + 1, false);
        return decodeMap(buf, view, offset + 5, len);
      }

      // ext8, ext16, ext32
      case 0xc7: {
        if (offset + 3 > buf.length) throw { incomplete: true };
        const len = buf[offset + 1];
        const type = view.getInt8(offset + 2);
        if (offset + 3 + len > buf.length) throw { incomplete: true };
        let id;
        if (len === 1) id = buf[offset + 3];
        else if (len === 2) id = view.getInt16(offset + 3, false);
        else if (len === 4) id = view.getInt32(offset + 3, false);
        else if (len === 8) id = Number(view.getBigInt64(offset + 3, false));
        else id = buf.subarray(offset + 3, offset + 3 + len);
        return { value: new NvimExt(type, id), nextOffset: offset + 3 + len };
      }
      case 0xc8: {
        if (offset + 4 > buf.length) throw { incomplete: true };
        const len = view.getUint16(offset + 1, false);
        const type = view.getInt8(offset + 3);
        if (offset + 4 + len > buf.length) throw { incomplete: true };
        let id;
        if (len === 1) id = buf[offset + 4];
        else if (len === 2) id = view.getInt16(offset + 4, false);
        else if (len === 4) id = view.getInt32(offset + 4, false);
        else if (len === 8) id = Number(view.getBigInt64(offset + 4, false));
        else id = buf.subarray(offset + 4, offset + 4 + len);
        return { value: new NvimExt(type, id), nextOffset: offset + 4 + len };
      }
      case 0xc9: {
        if (offset + 6 > buf.length) throw { incomplete: true };
        const len = view.getUint32(offset + 1, false);
        const type = view.getInt8(offset + 5);
        if (offset + 6 + len > buf.length) throw { incomplete: true };
        let id;
        if (len === 1) id = buf[offset + 6];
        else if (len === 2) id = view.getInt16(offset + 6, false);
        else if (len === 4) id = view.getInt32(offset + 6, false);
        else if (len === 8) id = Number(view.getBigInt64(offset + 6, false));
        else id = buf.subarray(offset + 6, offset + 6 + len);
        return { value: new NvimExt(type, id), nextOffset: offset + 6 + len };
      }

      // fixext 1, 2, 4, 8, 16
      case 0xd4: {
        if (offset + 3 > buf.length) throw { incomplete: true };
        const type = view.getInt8(offset + 1);
        const id = buf[offset + 2];
        return { value: new NvimExt(type, id), nextOffset: offset + 3 };
      }
      case 0xd5: {
        if (offset + 4 > buf.length) throw { incomplete: true };
        const type = view.getInt8(offset + 1);
        const id = view.getInt16(offset + 2, false);
        return { value: new NvimExt(type, id), nextOffset: offset + 4 };
      }
      case 0xd6: {
        if (offset + 6 > buf.length) throw { incomplete: true };
        const type = view.getInt8(offset + 1);
        const id = view.getInt32(offset + 2, false);
        return { value: new NvimExt(type, id), nextOffset: offset + 6 };
      }
      case 0xd7: {
        if (offset + 10 > buf.length) throw { incomplete: true };
        const type = view.getInt8(offset + 1);
        const id = Number(view.getBigInt64(offset + 2, false));
        return { value: new NvimExt(type, id), nextOffset: offset + 10 };
      }
      case 0xd8: {
        if (offset + 18 > buf.length) throw { incomplete: true };
        const type = view.getInt8(offset + 1);
        const id = buf.subarray(offset + 2, offset + 18);
        return { value: new NvimExt(type, id), nextOffset: offset + 18 };
      }

      default:
        throw new Error(`Unsupported msgpack byte: 0x${b.toString(16)} at offset ${offset}`);
    }
  }

  function decodeStr(buf, offset, len) {
    if (offset + len > buf.length) throw { incomplete: true };
    const slice = buf.subarray(offset, offset + len);
    const str = textDecoder.decode(slice);
    return { value: str, nextOffset: offset + len };
  }

  function decodeArray(buf, view, offset, len) {
    const arr = new Array(len);
    let cur = offset;
    for (let i = 0; i < len; i++) {
      const { value, nextOffset } = decodeValue(buf, view, cur);
      arr[i] = value;
      cur = nextOffset;
    }
    return { value: arr, nextOffset: cur };
  }

  function decodeMap(buf, view, offset, len) {
    const obj = {};
    let cur = offset;
    for (let i = 0; i < len; i++) {
      const k = decodeValue(buf, view, cur);
      cur = k.nextOffset;
      const v = decodeValue(buf, view, cur);
      cur = v.nextOffset;
      obj[k.value] = v.value;
    }
    return { value: obj, nextOffset: cur };
  }

  // Export to window or global
  if (typeof window !== 'undefined') {
    window.Msgpack = Msgpack;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Msgpack;
  }
})();
