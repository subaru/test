import type { Plugin, Rule } from '../index.js';

export interface ParsedAddress {
  postal: string | null;
  prefecture: string | null;
  city: string | null;
  rest: string;
}

/** 住所の正規化プラグイン：tidy(input, { plugins: [address()] }) */
export default function address(): Plugin;
export const addressRule: Rule;
export const PREFECTURES: string[];
/** 郵便番号・都道府県・市区町村・それ以降に分ける */
export function parseAddress(value: string): ParsedAddress;
/** 丁目・番地・号の表記を「4-6-16」の形に揃える */
export function normalizeBlock(rest: string): string;
/** 漢数字を数に（「十二」→ 12） */
export function kanjiToNumber(s: string): number | null;
