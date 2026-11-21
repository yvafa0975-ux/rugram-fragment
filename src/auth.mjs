import crypto from 'node:crypto';
import { pool, toBigInt } from './db.mjs';

const ttlHours = Number(process.env.FRAGMENT_SESSION_TTL_HOURS || 24);
const devCode = process.env.FRAGMENT_DEV_CODE || process.env.RUGRAM_DEV_AUTH_CODE || '12345';

export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function expectedCode() {
  return devCode;
}

export function checkCode(code) {
  return String(code || '') === devCode;
}

export async function findUserByPhone(phone) {
  const digits = normalizePhone(phone);
  if (digits.length < 6) return null;
  const { rows } = await pool.query(
    `SELECT id, phone, first_name, last_name
     FROM public.users
     WHERE regexp_replace(phone, '\\D', '', 'g') = $1
     ORDER BY id DESC
     LIMIT 1`,
    [digits]
  );
  return rows[0] || null;
}

export async function verifyPhoneCode(phone, code) {
  if (!checkCode(code)) return null;
  return findUserByPhone(phone);
}

export async function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO fragment_sessions (token, user_id, phone, expires_at)
     VALUES ($1, $2, $3, now() + ($4::int || ' hours')::interval)`,
    [token, String(user.id), normalizePhone(user.phone), ttlHours]
  );
  return token;
}

export async function userFromToken(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT s.user_id, s.phone, u.first_name, u.last_name
     FROM fragment_sessions s
     JOIN public.users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  if (!rows[0]) return null;
  return publicUser(rows[0]);
}

export function publicUser(row) {
  return {
    id: String(toBigInt(row.user_id ?? row.id)),
    phone: row.phone,
    firstName: row.first_name,
    lastName: row.last_name,
  };
}

export function bearer(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}
