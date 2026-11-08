// In-memory stand-in for a D1 binding, backed by node:sqlite. Tests only.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SCHEMA = new URL('../../schema.sql', import.meta.url);

export function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(SCHEMA, 'utf8'));

  const execute = (sql, args) => {
    const st = db.prepare(sql);
    if (st.columns().length) {
      return { success: true, results: st.all(...args).map((r) => ({ ...r })), meta: { changes: 0 } };
    }
    const r = st.run(...args);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };

  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    all: async () => execute(sql, args),
    run: async () => execute(sql, args),
    first: async (column) => {
      const row = execute(sql, args).results[0] ?? null;
      return row && column ? row[column] : row;
    },
    _execute: () => execute(sql, args),
  });

  return {
    prepare: (sql) => statement(sql),
    exec: async (sql) => { db.exec(sql); },
    // Like D1: all statements in one transaction, rolled back together on error.
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => s._execute());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
