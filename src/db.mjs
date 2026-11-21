import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export function loadEnv() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

const databaseUrl =
  process.env.FRAGMENT_DATABASE_URL ||
  process.env.RUGRAM_POSTGRES_DSN ||
  'postgres://rugram:CHANGE_ME@127.0.0.1:15432/rugram_main?sslmode=disable';

pg.types.setTypeParser(20, (value) => value);

export const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

const MIGRATIONS = [
  '0001_fragment_init.up.sql',
  '0002_number_market.up.sql',
  '0003_spin.up.sql',
];

export async function migrate() {
  for (const file of MIGRATIONS) {
    const sql = fs.readFileSync(path.join(rootDir, 'migrations', file), 'utf8');
    await pool.query(sql);
  }
}

export function toBigInt(value) {
  if (value === null || value === undefined || value === '') return 0n;
  return BigInt(String(value));
}

export function nanoToGrams(nano) {
  return Number(toBigInt(nano)) / 1e9;
}

export function gramsToNano(grams) {
  const n = Number(grams);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Некорректная сумма');
  return BigInt(Math.round(n * 1e9)).toString();
}
