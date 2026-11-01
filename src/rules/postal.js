import { HYPHENS } from './common.js';

const WITH_MARK = /^〒\s*(\d{3})-?(\d{4})$/;
const HYPHENATED = /^(\d{3})-(\d{4})$/;
const BARE = /^(\d{3})(\d{4})$/;

function parse(v, ctx = {}) {
  const s = v.replace(HYPHENS, '-');
  // 区切りのない7桁は、列名が郵便番号らしい場合だけ
  const m = s.match(WITH_MARK) || s.match(HYPHENATED) || (ctx.hinted && s.match(BARE));
  if (!m) return null;
  return { value: `${m[1]}-${m[2]}`, confidence: 1, note: '郵便番号を「123-4567」の形に統一' };
}

export default {
  type: 'postal',
  label: '郵便番号',
  hint: /郵便|〒|zip|postal/i,
  match: (v, ctx) => parse(v, ctx) !== null,
  normalize: parse,
};
