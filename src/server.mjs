import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, gramsToNano, nanoToGrams } from './db.mjs';
import {
  bearer,
  checkCode,
  createSession,
  expectedCode,
  findUserByPhone,
  normalizePhone,
  publicUser,
  userFromToken,
  verifyPhoneCode,
} from './auth.mjs';
import {
  buyNumber,
  createNumberAuction,
  getAuctions,
  getBalance,
  getMyNumbers,
  getSpinOdds,
  getStarsBalance,
  listNumbers,
  placeNumberBid,
  sellNumber,
  spinForNumber,
  syncRuGramNumbers,
  topUpDemo,
  topUpStarsToGrams,
} from './service.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const port = Number(process.env.FRAGMENT_PORT || 2700);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function headers(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }));
  res.end(body);
}

function fail(res, err) {
  const status = err && typeof err.code === 'number' && err.code >= 400 && err.code < 600 ? err.code : 400;
  json(res, status, { error: err?.message || 'Ошибка' });
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Слишком большой запрос');
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Некорректный JSON');
  }
}

async function requireUser(req) {
  const user = await userFromToken(bearer(req));
  if (!user) throw Object.assign(new Error('Нужно войти'), { code: 401 });
  return user;
}

function serveStatic(res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.resolve(publicDir, file);
  if (!full.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return json(res, 404, { error: 'Not found' });
  res.writeHead(200, {
    'Content-Type': mime[path.extname(full)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers());
      return res.end();
    }

    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/healthz' && req.method === 'GET') {
        return json(res, 200, { ok: true, service: 'rugram-fragment', market: 'numbers' });
      }

      if (pathname === '/api/auth/request' && req.method === 'POST') {
        await readJson(req);
        return json(res, 200, { ok: true, codeHint: `Демо-код: ${expectedCode()}` });
      }

      if (pathname === '/api/auth/verify' && req.method === 'POST') {
        const body = await readJson(req);
        if (!checkCode(body.code)) throw new Error('Неверный код');
        const user = await findUserByPhone(body.phone);
        if (!user) {
          throw new Error('Пользователь с таким номером не найден в RuGram. Сначала войди в веб-клиент RuGram.');
        }
        await syncRuGramNumbers(true);
        const token = await createSession(user);
        return json(res, 200, {
          token,
          user: { ...publicUser(user), phone: normalizePhone(user.phone) },
        });
      }

      // Вызов из веб-клиента RuGram: звёзды -> gram. Авторизация по номеру и демо-коду.
      if (pathname === '/api/wallet/topup-stars' && req.method === 'POST') {
        const body = await readJson(req);
        if (!checkCode(body.code)) throw Object.assign(new Error('Неверный код'), { code: 403 });
        const user = await findUserByPhone(body.phone);
        if (!user) throw Object.assign(new Error('Пользователь не найден'), { code: 404 });
        const result = await topUpStarsToGrams(user.id, body.stars);
        return json(res, 200, { ok: true, ...result, user: publicUser(user) });
      }

      if (pathname === '/api/me' && req.method === 'GET') {
        const user = await requireUser(req);
        const [balance, starsBalance, numbers] = await Promise.all([
          getBalance(user.id),
          getStarsBalance(user.id),
          getMyNumbers(user.id),
        ]);
        return json(res, 200, {
          user,
          balanceGrams: nanoToGrams(balance),
          starsBalance: Number(starsBalance),
          numbers,
        });
      }

      if (pathname === '/api/numbers' && req.method === 'GET') {
        const prefix = url.searchParams.get('prefix') || '';
        const q = url.searchParams.get('q') || '';
        return json(res, 200, {
          prefix,
          items: await listNumbers(prefix === '7' || prefix === '888' ? prefix : '', q),
        });
      }

      if (pathname === '/api/auctions' && req.method === 'GET') {
        return json(res, 200, { items: await getAuctions() });
      }

      if (pathname === '/api/numbers/spin-odds' && req.method === 'GET') {
        return json(res, 200, await getSpinOdds());
      }

      if (pathname === '/api/number/spin' && req.method === 'POST') {
        const user = await requireUser(req);
        await readJson(req);
        return json(res, 200, await spinForNumber(user.id));
      }

      let m = /^\/api\/number\/(\d+)\/buy$/.exec(pathname);
      if (m && req.method === 'POST') {
        const user = await requireUser(req);
        await readJson(req);
        return json(res, 200, await buyNumber(user.id, m[1]));
      }

      m = /^\/api\/number\/(\d+)\/sell$/.exec(pathname);
      if (m && req.method === 'POST') {
        const user = await requireUser(req);
        const body = await readJson(req);
        return json(res, 200, await sellNumber(user.id, m[1], body.priceGrams));
      }

      m = /^\/api\/number\/(\d+)\/auction$/.exec(pathname);
      if (m && req.method === 'POST') {
        const user = await requireUser(req);
        const body = await readJson(req);
        return json(res, 200, await createNumberAuction(user.id, m[1], gramsToNano(body.startingPrice), body.durationHours));
      }

      m = /^\/api\/auction\/(\d+)\/bid$/.exec(pathname);
      if (m && req.method === 'POST') {
        const user = await requireUser(req);
        const body = await readJson(req);
        return json(res, 200, await placeNumberBid(user.id, m[1], gramsToNano(body.amount)));
      }

      if (pathname === '/api/dev/topup' && req.method === 'POST') {
        const user = await requireUser(req);
        const body = await readJson(req);
        const balance = await topUpDemo(user.id, body.amount, body.secret);
        return json(res, 200, { ok: true, balanceGrams: nanoToGrams(balance) });
      }

      return json(res, 404, { error: 'Метод не найден' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(res, pathname);
    return json(res, 405, { error: 'Метод не поддерживается' });
  } catch (err) {
    console.error('[fragment]', err);
    fail(res, err);
  }
});

await migrate();
await syncRuGramNumbers(true);
server.listen(port, '0.0.0.0', () => {
  console.log(`[fragment] ready on http://0.0.0.0:${port}`);
});
