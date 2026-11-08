// A D1 stand-in filled with the demo data. Tests only.
import { createD1 } from './d1.mjs';
import { generate, toSql } from '../../scripts/seed-demo.mjs';

export const TODAY = '2026-10-11'; // 6 Sundays since 2026-09-06

export async function seededD1() {
  const db = createD1();
  await db.exec(toSql(generate({ today: TODAY })));
  return db;
}
