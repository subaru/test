/// <reference lib="dom" />
// nihon-tidy の型定義（v1.0 の公開API）

export type ColumnType = 'text' | 'date' | 'phone' | 'postal' | 'email' | 'boolean' | 'kana' | 'number' | 'address' | (string & {});
export type Value = string | number | boolean | null;
export type DataRecord = { [column: string]: Value };
export type Input = string | ArrayBuffer | Uint8Array | Blob | { name?: string; arrayBuffer(): Promise<ArrayBuffer | Uint8Array> } | object[];

export interface Rule {
  /** 列の種類の名前（schema の type になる） */
  type: string;
  /** 画面・レポートに出す名前 */
  label: string;
  /** 列名がこれに一致すると、この種類と判定しやすくなる */
  hint?: RegExp;
  /** この割合以上の値が一致しないと、この種類にしない（列名のヒントがあれば緩める） */
  minRatio?: number;
  match(value: string, ctx: { hinted: boolean }): boolean;
  /** 正規化した値と確信度（0〜1）。解釈できなければ null */
  normalize(value: string, ctx: { hinted: boolean; typed?: boolean }): { value: Value; confidence: number; note: string } | null;
}

export interface Plugin {
  name: string;
  rules: Rule[];
}

export interface TidyOptions {
  /** 形式（既定は自動判定） */
  format?: 'csv' | 'json' | 'xlsx' | 'html' | 'text';
  delimiter?: string;
  /** false で見出しなし */
  header?: boolean;
  /** Excel のシート名か番号 */
  sheet?: string | number;
  /** Excel の見出し行（0 から） */
  headerRow?: number;
  /** HTML のページ内の表の番号 */
  table?: number;
  /** 列ごとの指定。type で推論を上書き、cluster: false で表記ゆれの統一をしない */
  columns?: { [column: string]: { type?: ColumnType; cluster?: boolean } };
  /** これ未満の確信度の変換は適用せず提案にとどめる（既定 0.9） */
  minConfidence?: number;
  /** 表記ゆれの統一（既定 true） */
  cluster?: boolean;
  /** 列の種類と判定する一致率（既定 0.7） */
  threshold?: number;
  /** 列名にヒントがある場合の一致率（既定 0.5） */
  hintedThreshold?: number;
  /** プラグイン。組み込みは名前で指定できる（'address'）。detect・normalize を段階ごとに呼ぶときはオブジェクトで渡す */
  plugins?: Array<'address' | Plugin>;
  /** 段階ごとに呼ぶときの規則の組（ruleSet(address().rules) など）。plugins より優先する */
  ruleSet?: RuleSet;
}

export interface Column {
  name: string;
  type: ColumnType;
  label: string;
  /** 一致した割合（テキストの列は、どの種類にも当てはまらなかった割合） */
  confidence: number;
  hinted: boolean;
  forced?: boolean;
  nonEmpty: number;
  empty: number;
  unique: number;
  candidates: Array<{ type: string; label: string; ratio: number; hinted: boolean; minRatio: number }>;
}

export interface Change {
  row: number;
  column: string;
  before: Value;
  after: Value;
  /** 'common'（表記の統一）・'cluster'（表記ゆれ）・'manual'（手動）・列の種類 */
  rule: string;
  note: string;
  confidence: number;
  applied: boolean;
  dismissed?: boolean;
  reviewed?: boolean;
}

export interface Issue {
  row: number;
  column: string;
  value: Value;
  reason: string;
  suggestion?: Value;
}

export interface Cluster {
  column: string;
  canonical: string;
  variants: Array<{ value: string; count: number }>;
  confidence: number;
  applied: boolean;
  rows: number[];
}

export interface Meta {
  source: 'csv' | 'json' | 'xlsx' | 'html' | 'text' | 'records' | (string & {});
  name?: string;
  encoding?: string | null;
  delimiter?: string;
  /** Excel */
  sheet?: string;
  sheets?: string[];
  merged?: number;
  headerRow?: number;
  date1904?: boolean;
  /** HTML・テキストの読み取り方 */
  how?: string;
  tables?: number;
  title?: string;
}

export interface PlainResult {
  data: DataRecord[];
  schema: Column[];
  changes: Change[];
  issues: Issue[];
  clusters: Cluster[];
  meta: Meta;
}

export interface ViewController {
  refresh(): void;
  setView(view: 'table' | 'cards'): void;
}

export interface RenderOptions {
  view?: 'table' | 'cards';
  titleColumn?: string;
  placeholder?: string;
  /** false で既定のCSSを入れない */
  style?: boolean;
}

export interface TidyResult extends PlainResult {
  fix(row: number, column: string, value: Value, note?: string): void;
  accept(row: number, column: string): boolean;
  dismiss(row: number, column: string): void;
  acceptAll(): number;
  setCanonical(clusterIndex: number, canonical: string): void;
  toReport(options?: { title?: string }): string;
  toCSV(options?: { bom?: boolean; safe?: boolean }): string;
  toJSON(): DataRecord[];
  /** その時点の写し（後の fix などは反映されない） */
  toPlain(): PlainResult;
  toTableHTML(): string;
  toCardsHTML(options?: { titleColumn?: string }): string;
  render(el: Element | string, options?: RenderOptions): ViewController;
  renderReview(el: Element | string, options?: { onChange?(result: TidyResult): void }): { refresh(): void };
}

export interface Table {
  columns: string[];
  rows: string[][];
  meta: Meta;
  warnings: Issue[];
}

export function tidy(input: Input, options?: TidyOptions): Promise<TidyResult>;
/** Web Worker の中で tidy を動かす（Worker のない環境では tidy と同じ）。プラグインは名前で指定する */
export function tidyInWorker(input: Input, options?: Omit<TidyOptions, 'plugins'> & { plugins?: Array<'address'> }): Promise<TidyResult>;
/** toPlain() や Worker の結果に操作を付け直す（渡したオブジェクトをそのまま使い、コピーしない） */
export function hydrate(plain: PlainResult): TidyResult;

export function read(input: Input, options?: TidyOptions): Promise<Table>;
export function detect(table: Table, options?: TidyOptions): Column[];
export function normalize(table: Table, schema: Column[], options?: TidyOptions): { data: DataRecord[]; changes: Change[]; issues: Issue[] };
export function cluster(result: { data: DataRecord[]; schema: Column[]; changes: Change[]; issues: Issue[] }, options?: TidyOptions): Cluster[];
export function toReport(result: PlainResult, options?: { title?: string }): string;
export function toCSV(result: { schema: Column[]; data: DataRecord[] }, options?: { bom?: boolean; safe?: boolean }): string;
export function toTableHTML(result: { schema: Column[]; data: DataRecord[] }): string;
export function toCardsHTML(result: { schema: Column[]; data: DataRecord[] }, options?: { titleColumn?: string }): string;
export function render(el: Element | string, result: PlainResult, options?: RenderOptions): ViewController;
export function renderReview(el: Element | string, result: TidyResult, options?: { onChange?(result: TidyResult): void }): { refresh(): void };
export function fingerprint(value: string): string;
export const rules: Rule[];
export interface RuleSet {
  list: Rule[];
  byType: { [type: string]: Rule };
}
/** プラグインの規則を加えた規則の組。同じ type ならプラグインの規則を使う */
export function ruleSet(extra?: Rule[]): RuleSet;
