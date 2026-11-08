// Small SQL helpers shared by the data modules.

export const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;

export const now = () => new Date().toISOString();

export const textOrNull = (v) => String(v ?? '').trim() || null;

// Multi-row INSERT statements. D1 allows 100 bound parameters per statement, so rows are chunked.
export function insertMany(db, table, columns, rows, { orReplace = false } = {}) {
  const perStatement = Math.max(1, Math.floor(100 / columns.length));
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  const out = [];
  for (let i = 0; i < rows.length; i += perStatement) {
    const chunk = rows.slice(i, i + perStatement);
    out.push(db
      .prepare(`INSERT ${orReplace ? 'OR REPLACE ' : ''}INTO ${table} (${columns.join(', ')}) VALUES ${chunk.map(() => tuple).join(', ')}`)
      .bind(...chunk.flatMap((r) => columns.map((c) => r[c] ?? null))));
  }
  return out;
}

// Whole-table loads. The rows travel as one JSON parameter, so a statement carries thousands of rows:
// D1 counts every statement of a batch against its per-request query limit.
// maxChars keeps a parameter under D1's 2 MB value limit even when every character takes 3 bytes.
export function insertJson(db, table, columns, rows, { maxChars = 500000 } = {}) {
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${columns.map((_, i) => `json_extract(value, '$[${i}]')`).join(', ')} FROM json_each(?)`;
  const out = [];
  let chunk = [];
  let size = 0;
  const flush = () => {
    if (chunk.length) out.push(db.prepare(sql).bind(`[${chunk.join(',')}]`));
    chunk = [];
    size = 0;
  };
  for (const r of rows) {
    const text = JSON.stringify(columns.map((c) => r[c] ?? null));
    if (size + text.length > maxChars) flush();
    chunk.push(text);
    size += text.length + 1;
  }
  flush();
  return out;
}
