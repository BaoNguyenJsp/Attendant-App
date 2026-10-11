// The rarely changing lists kept in KV (D7). A save rewrites the value; clearCache and the rollover rebuild all.
import { cached, refresh, rebuildAll } from '../lib/cache.js';
import { listClasses, listGroups, listConfig, listHolidays, yearOptions } from '../lib/db/org.js';
import { listStudents } from '../lib/db/students.js';
import { getDirectory } from '../lib/db/users.js';

const loaders = (db) => ({
  students: () => listStudents(db),
  classes: () => listClasses(db),
  groups: () => listGroups(db),
  config: () => listConfig(db),
  holidays: () => listHolidays(db),
  years: () => yearOptions(db),
  directory: () => getDirectory(db),
});

export function makeLists(db, kv) {
  const load = loaders(db);
  return {
    get: (name) => cached(kv, name, load[name]),
    refresh: (name) => refresh(kv, name, load[name]),
    rebuild: () => rebuildAll(kv, load),
  };
}
