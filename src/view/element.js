// Web Component <tidy-table>。どのフレームワークからでも使える。
//
//   <tidy-table src="data.xlsx" view="cards" title-column="顧客名" report-button></tidy-table>
//
// 属性：src / view（table|cards） / title-column / sheet / min-confidence / report-button / review（要確認を直す画面を表示）
//       plugins（"address" など、カンマ区切り） / worker（Web Worker で処理して画面を止めない）
//       height（数万行の表を仮想スクロールで表示するときの高さ、px）
// プロパティ：input（File・文字列・配列を渡すと処理する） / result（処理結果）
// イベント：tidy-load（detail に処理結果） / tidy-change（修正のたび） / tidy-error（detail に Error）
import { tidy, tidyInWorker } from '../index.js';

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;

export class TidyTable extends Base {
  static observedAttributes = ['src', 'view', 'title-column', 'sheet', 'min-confidence', 'review', 'report-button', 'plugins', 'worker', 'height'];

  #input = null;
  #result = null;
  #controller = null;
  #loading = 0; // 読み込みの番号。古い読み込みが後から終わっても結果を使わない
  #fetchedSrc = null;

  get result() {
    return this.#result;
  }

  get input() {
    return this.#input;
  }

  set input(value) {
    this.#input = value;
    this.#load();
  }

  connectedCallback() {
    // 切り離されている間に src が変わっていたら読み込み直す
    const src = this.getAttribute('src');
    if (src && src !== this.#fetchedSrc) this.#fetch();
  }

  disconnectedCallback() {
    this.#loading++; // 切り離された後に終わった読み込みは捨てる
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.isConnected || oldValue === newValue) return;
    if (name === 'src') this.#fetch();
    else if (name === 'view' && this.#controller) this.#controller.setView(newValue || 'table');
    else if (name === 'title-column' || name === 'review' || name === 'report-button' || name === 'height') this.#draw();
    else this.#load();
  }

  async #fetch() {
    const src = this.getAttribute('src');
    if (!src) return;
    this.#fetchedSrc = src;
    const ticket = ++this.#loading;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${src} を読み込めません（${res.status}）`);
      const blob = await res.blob();
      if (ticket !== this.#loading) return;
      this.#input = Object.assign(blob, { name: decodeURIComponent(new URL(src, location.href).pathname.split('/').pop()) });
      await this.#load();
    } catch (error) {
      if (ticket === this.#loading) this.#fail(error);
    }
  }

  async #load() {
    if (this.#input === null) return;
    const ticket = ++this.#loading;
    const options = {};
    const sheet = this.getAttribute('sheet');
    if (sheet) options.sheet = /^\d+$/.test(sheet) ? Number(sheet) : sheet;
    const min = this.getAttribute('min-confidence');
    if (min) options.minConfidence = Number(min);
    const plugins = this.getAttribute('plugins');
    if (plugins) options.plugins = plugins.split(',').map((p) => p.trim()).filter(Boolean);
    try {
      const result = await (this.hasAttribute('worker') ? tidyInWorker : tidy)(this.#input, options);
      if (ticket !== this.#loading) return;
      this.#result = result;
      this.#draw();
      this.dispatchEvent(new CustomEvent('tidy-load', { detail: result }));
    } catch (error) {
      if (ticket === this.#loading) this.#fail(error);
    }
  }

  #draw() {
    if (!this.#result) return;
    this.replaceChildren();
    const view = document.createElement('div');
    if (this.hasAttribute('review')) {
      const panel = document.createElement('div');
      this.append(panel);
      this.#result.renderReview(panel, {
        onChange: (result) => {
          this.#controller?.refresh();
          this.dispatchEvent(new CustomEvent('tidy-change', { detail: result }));
        },
      });
    }
    this.append(view);
    this.#controller = this.#result.render(view, {
      view: this.getAttribute('view') || 'table',
      titleColumn: this.getAttribute('title-column') || undefined,
      height: Number(this.getAttribute('height')) || undefined,
    });
    if (this.hasAttribute('report-button')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '分析レポートを開く';
      button.style.cssText = 'font:inherit;margin-left:auto';
      button.addEventListener('click', () => this.openReport());
      view.querySelector('.tidy-bar')?.append(button);
    }
  }

  openReport() {
    if (!this.#result) return null;
    const url = URL.createObjectURL(new Blob([this.#result.toReport()], { type: 'text/html' }));
    const win = window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return win;
  }

  #fail(error) {
    // 古い結果が後の描き直しでエラー表示を上書きしないよう、結果も捨てる
    this.#result = null;
    this.#controller = null;
    this.textContent = error.message;
    this.dispatchEvent(new CustomEvent('tidy-error', { detail: error }));
  }
}

export function defineElements(name = 'tidy-table') {
  if (typeof customElements !== 'undefined' && !customElements.get(name)) customElements.define(name, TidyTable);
}

defineElements();
