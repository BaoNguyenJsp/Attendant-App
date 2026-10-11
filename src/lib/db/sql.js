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
