// RFC 4180準拠のCSVパーサー。引用符内の改行・カンマ・"" に対応する。

const CANDIDATES = [',', '\t', ';', '|'];

// 先頭数行で列数が最も安定する区切り文字を選ぶ
export function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => l.split(d).length - 1);
    if (counts[0] === 0) continue;
    const stable = counts.filter((c) => c === counts[0]).length / counts.length;
    const score = stable * counts[0];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export function parseCSV(text, delimiter = sniffDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  return { rows: rows.filter((r) => r.some((v) => v.trim() !== '')), delimiter };
}
