import type { TidyResult, Input } from '../index.js';

/**
 * <tidy-table src="data.xlsx" view="cards" title-column="顧客名" plugins="address" worker review report-button>
 * イベント：tidy-load / tidy-change（detail に結果） / tidy-error（detail に Error）
 */
export class TidyTable extends HTMLElement {
  readonly result: TidyResult | null;
  input: Input | null;
  openReport(): Window | null;
}
export function defineElements(name?: string): void;

declare global {
  interface HTMLElementTagNameMap {
    'tidy-table': TidyTable;
  }
}
