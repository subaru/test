// tidy を Web Worker の中で動かす。結果は tidy と同じ操作（fix・render など）を持つ。
// Worker が使えない環境（Node.js など）では、そのまま tidy を呼ぶ。
// Worker にはオブジェクトの関数を渡せないので、プラグインは名前（'address' など）で指定する。
export async function tidyInWorker(input, options = {}) {
  const { tidy, hydrate } = await import('./index.js');
  if (typeof Worker === 'undefined') return tidy(input, options);
  if ((options.plugins ?? []).some((p) => typeof p !== 'string')) {
    throw new TypeError('tidyInWorker では、プラグインを名前（"address" など）で指定してください');
  }

  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  try {
    const plain = await new Promise((resolve, reject) => {
      worker.onmessage = (e) => (e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result));
      worker.onerror = (e) => reject(new Error(e.message || 'Web Worker で処理できませんでした'));
      worker.postMessage({ id: 1, input, options });
    });
    return hydrate(plain);
  } finally {
    worker.terminate();
  }
}
