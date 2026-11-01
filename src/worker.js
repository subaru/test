// Web Worker の中で tidy を動かす（tidyInWorker から使う）。画面の処理を止めずに大きなファイルを扱える
import { tidy } from './index.js';

self.onmessage = async (e) => {
  const { id, input, options } = e.data;
  try {
    const result = await tidy(input, options);
    self.postMessage({ id, result: result.toPlain() });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
