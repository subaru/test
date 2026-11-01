// すべての値に共通する表記の統一。
// NFKC で全角英数字→半角、半角カナ→全角カナ、㈱→(株) などをまとめて統一する。
// ただし、変換すると意味が変わる文字（丸数字・分数・上付き数字・波ダッシュ）はそのまま残す。
const PROTECTED = /[①-⓿㉑-㉟㊱-㊿⅐-⅟¼-¾²³¹⁰-₟～〜]+/g;

function nfkc(s) {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(PROTECTED)) {
    out += s.slice(last, m.index).normalize('NFKC') + m[0];
    last = m.index + m[0].length;
  }
  return out + s.slice(last).normalize('NFKC');
}

export function clean(raw) {
  if (raw == null) return '';
  return nfkc(String(raw))
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/\r\n?/g, '\n')
    // 改行は備考などで意味を持つので残し、行内の空白だけを詰める
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

// ハイフンに見える文字（長音記号・ダッシュ類・全角マイナス）をASCIIのハイフンに揃える
export const HYPHENS = /[‐‑‒–—―−ー﹣]/g;

// 「値がない」ことを表す記号。型のある列では空として扱う
export const PLACEHOLDERS = new Set(['-', '--', '―', '—', 'ー', 'N/A', 'n/a', '#N/A', 'NA', 'null', 'NULL']);
