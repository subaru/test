// tidy を Web Worker の中で動かす。結果は tidy と同じ操作（fix・render など）を持つ。
// Worker が使えない環境（Node.js、別のオリジンから読み込んだ場合、worker.js が見つからない場合など）では、
// メインスレッドで tidy を呼ぶ。Worker にはオブジェクトの関数を渡せないので、プラグインは名前（'address' など）で指定する。
let warned = false;

export async function tidyInWorker(input, options = {}) {
  const { tidy, hydrate } = await import('./index.js');
  const plugins = options.plugins ?? [];
  if (!Array.isArray(plugins) || plugins.some((p) => typeof p !== 'string')) {
    throw new TypeError('tidyInWorker では、プラグインを名前の配列（["address"] など）で指定してください');
  }
  if (options.ruleSet) throw new TypeError('tidyInWorker では ruleSet は使えません（Worker に関数を渡せないため）。プラグインを名前で指定してください');
  if (typeof Worker === 'undefined') return tidy(input, options);

  // { name, arrayBuffer() } の形の入力は、Worker に渡せるようにバイト列を読んでおく
  let payload = input;
  if (input && typeof input.arrayBuffer === 'function' && !(typeof Blob !== 'undefined' && input instanceof Blob)) {
    const bytes = await input.arrayBuffer();
    payload = typeof File !== 'undefined' ? new File([bytes], input.name ?? 'data') : bytes;
  }

  // Worker を使えないときはメインスレッドで処理する。読み終えた入力（payload）を使う（1回しか読めない入力もあるため）
  const fallback = (reason) => {
    if (!warned) {
      warned = true;
      console.warn(`nihon-tidy: Web Worker を使えないため、メインスレッドで処理します（${reason}）`);
    }
    return tidy(payload, options);
  };

  let worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch (error) {
    return fallback(error.message); // 別のオリジンから読み込んだ場合など
  }
  try {
    const outcome = await new Promise((resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      // worker.js を読み込めなかった（見つからない・バンドルに含まれていない）
      worker.onerror = (e) => {
        e.preventDefault?.();
        resolve({ unavailable: e.message || 'worker.js を読み込めません' });
      };
      worker.onmessageerror = () => resolve({ error: { name: 'Error', message: 'Web Worker から結果を受け取れませんでした' } });
      worker.postMessage({ id: 1, input: payload, options });
    });
    if (outcome.unavailable) return fallback(outcome.unavailable);
    if ('error' in outcome) {
      const error = new Error(outcome.error.message);
      error.name = outcome.error.name;
      if (outcome.error.stack) error.stack = outcome.error.stack;
      throw error;
    }
    return hydrate(outcome.result);
  } finally {
    worker.terminate();
  }
}
