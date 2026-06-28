import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export type TeamsDb = Database.Database;

const moduleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function openModuleDb(dataDir: string): TeamsDb {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'teams.module.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

function runMigrations(db: TeamsDb): void {
  db.exec(`create table if not exists schema_migrations (
    id text primary key,
    applied_at integer not null
  )`);
  const applied = new Set(
    db.prepare('select id from schema_migrations').all().map((r) => (r as { id: string }).id),
  );
  const migrationsDir = path.join(moduleRoot, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    db.prepare('insert into schema_migrations (id, applied_at) values (?, ?)').run(file, Date.now());
  }
}
