// Runs once, in the main process, before vitest spawns its per-test-file
// workers. Each test file imports backend/src/server.js fresh and connects
// its own Database() instance to the same on-disk sqlite file — this app's
// migration logic (backend/src/models/database.js) assumes single-process
// ownership (same as its production deploy: one Node process, one file), so
// concurrent workers racing to apply the same migration for the first time
// corrupts it (two processes both read the old user_version, both try to
// apply it, second fails). Applying migrations here, before any worker
// starts, means every worker's later `db.connect()` just finds the schema
// already current and does nothing.
import Database from '../backend/src/models/database.js';

export default async function globalSetup() {
  const db = new Database();
  await db.connect();
  await db.close();
}
