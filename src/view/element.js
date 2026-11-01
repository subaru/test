// Web Component <tidy-table>。どのフレームワークからでも使える。
//
//   <tidy-table src="data.xlsx" view="cards" title-column="顧客名" report-button></tidy-table>
//
// 属性：src / view（table|cards） / title-column / sheet / min-confidence / report-button / review（要確認を直す画面を表示）
// プロパティ：input（File・文字列・配列を渡すと処理する） / result（処理結果）
// イベント：tidy-load（detail に処理結果） / tidy-change（修正のたび） / tidy-error（detail に Error）
import { tidy } from '../index.js';

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;

export class TidyTable extends Base {
  static observedAttributes = ['src', 'view', 'title-column', 'sheet', 'min-confidence', 'review'];

  #input = null;
  #result = null;
  #controller = null;
  #loading = 0;

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
    if (this.#input === null && this.getAttribute('src')) this.#fetch();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.isConnected || oldValue === newValue) return;
    if (name === 'src') this.#fetch();
    else if (name === 'view' && this.#controller) this.#controller.setView(newValue || 'table');
    else if (name === 'title-column' || name === 'review') this.#draw();
    else this.#load();
  }

  async #fetch() {
    const src = this.getAttribute('src');
    if (!src) return;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${src} を読み込めません（${res.status}）`);
      const blob = await res.blob();
      this.#input = Object.assign(blob, { name: decodeURIComponent(new URL(src, location.href).pathname.split('/').pop()) });
      await this.#load();
    } catch (error) {
      this.#fail(error);
    }
  }

  async #load() {
    if (this.#input === null) return;
    const ticket = ++this.#loading; // 古い読み込みが後から終わっても上書きしない
    const options = {};
    const sheet = this.getAttribute('sheet');
    if (sheet) options.sheet = /^\d+$/.test(sheet) ? Number(sheet) : sheet;
    const min = this.getAttribute('min-confidence');
    if (min) options.minConfidence = Number(min);
    try {
      const result = await tidy(this.#input, options);
      if (ticket !== this.#loading) return;
      this.#result = result;
      this.#draw();
      this.dispatchEvent(new CustomEvent('tidy-load', { detail: result }));
    } catch (error) {
      this.#fail(error);
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
    return window.open(url, '_blank');
  }

  #fail(error) {
    this.textContent = error.message;
    this.dispatchEvent(new CustomEvent('tidy-error', { detail: error }));
  }
}

export function defineElements(name = 'tidy-table') {
  if (typeof customElements !== 'undefined' && !customElements.get(name)) customElements.define(name, TidyTable);
}

defineElements();
