// すべての値に共通する表記の統一。
// NFKC で全角英数字→半角、半角カナ→全角カナ、㈱→(株) などをまとめて統一する。
export function clean(raw) {
  if (raw == null) return '';
  return String(raw)
    .normalize('NFKC')
    .replace(/[​﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ハイフンに見える文字（長音記号・ダッシュ類）をASCIIのハイフンに揃える
export const HYPHENS = /[‐‑‒–—―−ー﹣]/g;
