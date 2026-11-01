// バイト列を文字列に変換する。UTF-8（BOM付き含む）→ Shift_JIS の順に試す。

export function decode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'utf-8-bom' };
  }

  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'utf-8' };
  } catch {
    // UTF-8として不正 → Excelで保存したCSVに多いShift_JIS（Windows-31J）とみなす
    return { text: new TextDecoder('shift_jis').decode(u8), encoding: 'shift_jis' };
  }
}
