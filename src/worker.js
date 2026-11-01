// Web Worker の中で tidy を動かす（tidyInWorker から使う）。画面の処理を止めずに大きなファイルを扱える。
// Worker の外（ページのメインスレッドなど）で読み込まれても何もしない
import { tidy } from './index.js';

const inWorker = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;

if (inWorker) {
  self.onmessage = async (e) => {
    const { id, input, options } = e.data ?? {};
    if (typeof id !== 'number') return; // tidyInWorker 以外からのメッセージは無視する
    try {
      const result = await tidy(input, options);
      self.postMessage({ id, result: result.toPlain() });
    } catch (error) {
      self.postMessage({ id, error: { name: error?.name ?? 'Error', message: String(error?.message ?? error), stack: error?.stack } });
    }
  };
}
