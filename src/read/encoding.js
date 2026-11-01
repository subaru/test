// バイト列を文字列に変換する。UTF-8（BOM付き含む）→ Shift_JIS の順に試す。

export function decode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'utf-8-bom' };
  }

  // Excelの「Unicodeテキスト」はBOM付きのUTF-16
  if (u8[0] === 0xff && u8[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'utf-16le' };
  if (u8[0] === 0xfe && u8[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), encoding: 'utf-16be' };
  // BOMなしのUTF-16：ASCII文字の半分がNULになる
  const head = u8.subarray(0, 512);
  const nulAt = (parity) => head.filter((b, i) => b === 0 && i % 2 === parity).length;
  if (head.length >= 4 && nulAt(1) > head.length / 4 && nulAt(0) === 0) return { text: new TextDecoder('utf-16le').decode(u8), encoding: 'utf-16le' };
  if (head.length >= 4 && nulAt(0) > head.length / 4 && nulAt(1) === 0) return { text: new TextDecoder('utf-16be').decode(u8), encoding: 'utf-16be' };

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'utf-8' };
  } catch {
    // UTF-8として不正 → Excelで保存したCSVに多いShift_JIS（Windows-31J）とみなす
    return { text: new TextDecoder('shift_jis').decode(u8), encoding: 'shift_jis' };
  }
}
