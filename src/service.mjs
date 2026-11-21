import { pool, toBigInt, nanoToGrams, gramsToNano } from './db.mjs';

const E9 = 1_000_000_000n;
const STARS_TO_GRAM_RATE = Number(process.env.FRAGMENT_STARS_TO_GRAM_RATE || 1);
let lastRuGramSync = 0;

// Рулетка: шансы зафиксированы, каждый выпад можно продать минимум за 3000 gram.
const SPIN_PRICE_NANO = 10n * E9;
const SPIN_TIERS = [
  { key: 'ordinary', label: 'Обычный', probability: 70, priceGrams: 3000, color: '#94a3b8' },
  { key: 'rare', label: 'Редкий', probability: 25, priceGrams: 6000, color: '#6a8dff' },
  { key: 'epic', label: 'Особый', probability: 4, priceGrams: 15000, color: '#9b6cff' },
  { key: 'legendary', label: 'Легендарный', probability: 1, priceGrams: 30000, color: '#ffd479' },
];
const SPIN_VAULT_MIN = 8;

const DIGIT_COLORS = [
  '#6a8dff', '#48d597', '#ffd479', '#ff8fa3', '#9b6cff',
  '#4dd0e1', '#ff9f43', '#a3e635', '#f472b6', '#94a3b8',
];

function normalizeDigits(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('888')) return { digits: d, prefix: '888' };
  if (d.startsWith('7') && d.length === 11) return { digits: d.slice(1), prefix: '7' };
  if (d.length === 10) return { digits: d, prefix: '7' };
  return null;
}

export function formatNumber(digits, prefix) {
  if (prefix === '888') return `+888 ${digits.slice(3)}`;
  const d = digits.padEnd(10, '0').slice(0, 10);
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}

export function analyzeNumber(digits, prefix) {
  const body = prefix === '888' ? digits.slice(3) : digits;
  const source = body || digits;
  const counts = Array(10).fill(0);
  for (const ch of source) counts[Number(ch)]++;

  const unique = counts.filter((c) => c > 0).length;
  let maxRepeat = 1;
  let repeatDigit = source[0];
  let run = 1;
  for (let i = 1; i < source.length; i++) {
    if (source[i] === source[i - 1]) {
      run++;
    } else {
      run = 1;
    }
    if (run > maxRepeat) {
      maxRepeat = run;
      repeatDigit = source[i];
    }
  }

  let trailingZeros = 0;
  for (let i = source.length - 1; i >= 0 && source[i] === '0'; i--) trailingZeros++;

  const isPalindrome = source === [...source].reverse().join('');
  const hasAsc = /0123|1234|2345|3456|4567|5678|6789/.test(source);
  const hasDesc = /9876|8765|7654|6543|5432|4321|3210/.test(source);
  const hasSequence = hasAsc || hasDesc;

  let score = 10 + (10 - unique) * 5;
  if (maxRepeat >= 3) score += (maxRepeat - 2) * 11;
  if (trailingZeros >= 3) score += (trailingZeros - 2) * 7;
  if (isPalindrome) score += 26;
  if (hasSequence) score += 45;
  if (source.length <= 4) score += 18;
  score = Math.max(1, Math.min(100, Math.round(score)));

  const label = score >= 85 ? 'Легендарный' : score >= 65 ? 'Редкий' : score >= 42 ? 'Особый' : 'Обычный';

  const features = [];
  if (maxRepeat >= 3) features.push(`повтор ${repeatDigit} ×${maxRepeat}`);
  if (isPalindrome) features.push('зеркало');
  if (hasAsc) features.push('по порядку');
  if (hasDesc) features.push('в обратном порядке');
  if (trailingZeros >= 3) features.push(`${trailingZeros} нуля на конце`);
  if (!features.length) features.push('обычная комбинация');

  const segments = counts
    .map((count, digit) => ({ digit, count, share: source.length ? count / source.length : 0, color: DIGIT_COLORS[digit] }))
    .filter((seg) => seg.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    score,
    label,
    pattern: features.join(' · '),
    segments,
    unique,
    maxRepeat,
    trailingZeros,
    length: source.length,
  };
}

export async function syncRuGramNumbers(force = false) {
  if (!force && Date.now() - lastRuGramSync < 30_000) return;
  lastRuGramSync = Date.now();
  const { rows } = await pool.query(`
    SELECT p.phone AS phone, p.owner_user_id AS owner_id
    FROM public.collectible_phones p
    WHERE p.status = 'owned' AND p.owner_user_id > 0
    UNION ALL
    SELECT u.phone, u.id
    FROM public.users u
    WHERE u.phone <> '' AND u.phone ~ '^[0-9]{4,12}$'
  `);
  for (const row of rows) {
    const parsed = normalizeDigits(row.phone);
    if (!parsed) continue;
    const rarity = analyzeNumber(parsed.digits, parsed.prefix).score;
    await pool.query(
      `INSERT INTO fragment_numbers (digits, prefix, owner_user_id, status, rarity)
       VALUES ($1, $2, $3, 'owned', $4)
       ON CONFLICT (digits) DO UPDATE SET
         owner_user_id = CASE WHEN fragment_numbers.owner_user_id = 0 THEN EXCLUDED.owner_user_id
                              ELSE fragment_numbers.owner_user_id END,
         status = CASE WHEN fragment_numbers.owner_user_id = 0 THEN 'owned' ELSE fragment_numbers.status END,
         rarity = EXCLUDED.rarity`,
      [parsed.digits, parsed.prefix, String(row.owner_id), rarity]
    );
  }
}

export async function getBalance(userId) {
  const { rows } = await pool.query(
    'SELECT balance_nanoton FROM public.ton_balances WHERE user_id = $1',
    [String(userId)]
  );
  return rows[0] ? toBigInt(rows[0].balance_nanoton) : 0n;
}

export async function getStarsBalance(userId) {
  const { rows } = await pool.query(
    'SELECT balance FROM public.stars_balances WHERE user_id = $1',
    [String(userId)]
  );
  return rows[0] ? toBigInt(rows[0].balance) : 0n;
}

async function ensureBalance(client, userId) {
  await client.query(
    `INSERT INTO public.ton_balances (user_id, balance_nanoton, granted)
     VALUES ($1, 0, true) ON CONFLICT (user_id) DO NOTHING`,
    [String(userId)]
  );
}

async function ensureStarsBalance(client, userId) {
  await client.query(
    `INSERT INTO public.stars_balances (user_id, balance, granted)
     VALUES ($1, 0, true) ON CONFLICT (user_id) DO NOTHING`,
    [String(userId)]
  );
}

async function balanceFromClient(client, userId) {
  const { rows } = await client.query(
    'SELECT balance_nanoton FROM public.ton_balances WHERE user_id = $1',
    [String(userId)]
  );
  return rows[0] ? toBigInt(rows[0].balance_nanoton) : 0n;
}

async function moveGrams(client, fromId, toId, amount, reason) {
  if (amount <= 0n) return;
  const from = await balanceFromClient(client, fromId);
  if (from < amount) throw Object.assign(new Error('Недостаточно gram'), { code: 402 });
  await client.query(
    'UPDATE public.ton_balances SET balance_nanoton = balance_nanoton - $2, updated_at = now() WHERE user_id = $1',
    [String(fromId), amount.toString()]
  );
  if (toId && String(toId) !== '0') {
    await ensureBalance(client, toId);
    await client.query(
      'UPDATE public.ton_balances SET balance_nanoton = balance_nanoton + $2, updated_at = now() WHERE user_id = $1',
      [String(toId), amount.toString()]
    );
  }
  const date = Math.floor(Date.now() / 1000);
  await client.query(
    'INSERT INTO public.ton_transactions (user_id, amount_nanoton, reason, date) VALUES ($1, $2, $3, $4)',
    [String(fromId), (-amount).toString(), reason, date]
  );
  if (toId && String(toId) !== '0') {
    await client.query(
      'INSERT INTO public.ton_transactions (user_id, amount_nanoton, reason, date) VALUES ($1, $2, $3, $4)',
      [String(toId), amount.toString(), reason, date]
    );
  }
}

export async function topUpStarsToGrams(userId, starsInput) {
  const stars = BigInt(starsInput);
  if (stars <= 0n || stars > 1_000_000_000n) throw new Error('Некорректное количество звёзд');
  if (!(STARS_TO_GRAM_RATE > 0)) throw new Error('Некорректный курс обмена');
  // Курс может быть дробным (например, 5000 звёзд = 1 gram => 0.0002 gram за звезду).
  // Считаем сразу в нано, иначе Math.round(0.0002) даст 0 для одной звезды.
  const nano = BigInt(Math.round(Number(stars) * STARS_TO_GRAM_RATE * 1e9));
  if (nano <= 0n) throw new Error('Слишком маленькая сумма');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureStarsBalance(client, userId);
    await ensureBalance(client, userId);

    const { rows } = await client.query(
      'SELECT balance FROM public.stars_balances WHERE user_id = $1 FOR UPDATE',
      [String(userId)]
    );
    const balance = toBigInt(rows[0]?.balance);
    if (balance < stars) {
      throw Object.assign(new Error(`Недостаточно звёзд: нужно ${stars}, есть ${balance}`), { code: 402 });
    }

    await client.query(
      'UPDATE public.stars_balances SET balance = balance - $2, updated_at = now() WHERE user_id = $1',
      [String(userId), stars.toString()]
    );
    await client.query(
      'UPDATE public.ton_balances SET balance_nanoton = balance_nanoton + $2, updated_at = now() WHERE user_id = $1',
      [String(userId), nano.toString()]
    );
    const date = Math.floor(Date.now() / 1000);
    await client.query(
      `INSERT INTO public.stars_transactions (user_id, amount, reason, title, date)
       VALUES ($1, $2, 'fragment_gram_topup', 'Обмен на gram', $3)`,
      [String(userId), (-stars).toString(), date]
    );
    await client.query(
      `INSERT INTO public.ton_transactions (user_id, amount_nanoton, reason, date)
       VALUES ($1, $2, 'stars to gram', $3)`,
      [String(userId), nano.toString(), date]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const [starsBalance, gramBalance] = await Promise.all([
    getStarsBalance(userId),
    getBalance(userId),
  ]);
  return {
    starsBalance: Number(starsBalance),
    gramBalance: Number(gramBalance) / 1e9,
    rate: STARS_TO_GRAM_RATE,
  };
}

export async function topUpDemo(userId, amount, secret) {
  if (secret !== (process.env.FRAGMENT_TOPUP_SECRET || 'change-me')) {
    throw Object.assign(new Error('Неверный секрет пополнения'), { code: 403 });
  }
  const nano = gramsToNano(amount);
  if (nano > BigInt(1_000_000_000) * E9) throw new Error('Слишком большая сумма');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureBalance(client, userId);
    await client.query(
      'UPDATE public.ton_balances SET balance_nanoton = balance_nanoton + $2, updated_at = now() WHERE user_id = $1',
      [String(userId), nano]
    );
    await client.query(
      `INSERT INTO public.ton_transactions (user_id, amount_nanoton, reason, date) VALUES ($1, $2, 'fragment demo topup', $3)`,
      [String(userId), nano, Math.floor(Date.now() / 1000)]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getBalance(userId);
}

function mapNumber(row) {
  const rarity = analyzeNumber(row.digits, row.prefix);
  const ownerId = toBigInt(row.owner_user_id);
  return {
    id: String(row.id),
    digits: row.digits,
    prefix: row.prefix,
    display: formatNumber(row.digits, row.prefix),
    status: row.status,
    priceGrams: nanoToGrams(row.price_nano),
    owner: ownerId > 0n
      ? {
          id: String(ownerId),
          name: [row.owner_first, row.owner_last].filter(Boolean).join(' ') || 'Пользователь',
        }
      : null,
    rarity,
    auction: row.auction_id
      ? {
          id: String(row.auction_id),
          currentBidGrams: nanoToGrams(row.current_bid_nano),
          startingPriceGrams: nanoToGrams(row.starting_price_nano),
          endsAt: row.ends_at,
          highestBidderId: toBigInt(row.highest_bidder_user_id) > 0n
            ? String(row.highest_bidder_user_id) : null,
        }
      : null,
  };
}

const NUMBER_SELECT = `
  SELECT n.*, u.first_name AS owner_first, u.last_name AS owner_last,
         a.id AS auction_id, a.current_bid_nano, a.starting_price_nano, a.ends_at, a.highest_bidder_user_id
  FROM fragment_numbers n
  LEFT JOIN public.users u ON u.id = n.owner_user_id
  LEFT JOIN fragment_number_auctions a
    ON a.number_id = n.id AND a.status = 'active'
`;

export async function listNumbers(prefix, search = '') {
  await syncRuGramNumbers();
  await settleAuctions();
  const where = [];
  const params = [];
  if (prefix === '7' || prefix === '888') {
    params.push(prefix);
    where.push(`n.prefix = $${params.length}`);
  }
  if (String(search || '').trim()) {
    params.push(`%${String(search).replace(/\D/g, '')}%`);
    where.push(`n.digits LIKE $${params.length}`);
  }
  const sql = NUMBER_SELECT
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + ` ORDER BY CASE n.status WHEN 'vault' THEN 0 WHEN 'auction' THEN 1 ELSE 2 END,
                n.price_nano DESC, n.rarity DESC, n.digits
       LIMIT 500`;
  const { rows } = await pool.query(sql, params);
  return rows.map(mapNumber);
}

export async function getMyNumbers(userId) {
  await syncRuGramNumbers();
  const { rows } = await pool.query(NUMBER_SELECT + ' WHERE n.owner_user_id = $1 ORDER BY n.digits', [String(userId)]);
  return rows.map(mapNumber);
}

export async function buyNumber(userId, numberId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM fragment_numbers WHERE id = $1 FOR UPDATE', [String(numberId)]);
    const item = rows[0];
    if (!item) throw Object.assign(new Error('Номер не найден'), { code: 404 });
    if (item.status === 'auction') throw new Error('Номер участвует в аукционе');
    if (toBigInt(item.owner_user_id) === BigInt(userId)) throw new Error('Это уже ваш номер');
    const price = toBigInt(item.price_nano);
    if (price <= 0n) throw new Error('Номер не выставлен на продажу');
    await ensureBalance(client, userId);
    await moveGrams(client, userId, item.owner_user_id, price, `fragment buy ${item.digits}`);
    await client.query(
      `UPDATE fragment_numbers SET owner_user_id = $2, status = 'owned', price_nano = 0, updated_at = now() WHERE id = $1`,
      [String(item.id), String(userId)]
    );
    await client.query(
      `INSERT INTO fragment_number_purchases (number_id, buyer_user_id, seller_user_id, amount_nano, kind)
       VALUES ($1, $2, $3, $4, 'buy')`,
      [String(item.id), String(userId), String(item.owner_user_id || 0), price.toString()]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

function pickSpinTier() {
  let roll = Math.random() * 100;
  for (const tier of SPIN_TIERS) {
    roll -= tier.probability;
    if (roll < 0) return tier;
  }
  return SPIN_TIERS[SPIN_TIERS.length - 1];
}

// Хранилище +888 пополняется автоматически, чтобы крутить можно было постоянно.
async function ensureSpinVault(client) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS count FROM fragment_numbers WHERE prefix = '888' AND status = 'vault' AND owner_user_id = 0"
  );
  let missing = Math.max(0, SPIN_VAULT_MIN - Number(rows[0]?.count || 0));
  while (missing > 0) {
    const digits = '888' + Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join('');
    const inserted = await client.query(
      `INSERT INTO fragment_numbers (digits, prefix, status, rarity)
       VALUES ($1, '888', 'vault', 0) ON CONFLICT (digits) DO NOTHING`,
      [digits]
    );
    if (inserted.rowCount > 0) missing--;
  }
}

export async function getSpinOdds() {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM fragment_numbers WHERE prefix = '888' AND status = 'vault' AND owner_user_id = 0"
  );
  return {
    costGrams: 10,
    guaranteedMinGrams: Math.min(...SPIN_TIERS.map((tier) => tier.priceGrams)),
    available: Number(rows[0]?.count || 0),
    tiers: SPIN_TIERS.map(({ key, label, probability, priceGrams, color }) => ({
      key, label, probability, priceGrams, color,
    })),
  };
}

// Рулетка: 10 gram -> случайный свободный номер +888 с фиксированной ценой продажи.
export async function spinForNumber(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureBalance(client, userId);

    const balance = await balanceFromClient(client, userId);
    if (balance < SPIN_PRICE_NANO) {
      throw Object.assign(new Error('Нужно 10 gram, чтобы крутануть рулетку'), { code: 402 });
    }

    await ensureSpinVault(client);
    const tier = pickSpinTier();
    const price = gramsToNano(tier.priceGrams);

    const { rows } = await client.query(`
      SELECT id, digits, prefix FROM fragment_numbers
      WHERE prefix = '888' AND status = 'vault' AND owner_user_id = 0
      ORDER BY random()
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    const item = rows[0];
    if (!item) throw new Error('Все номера +888 уже разобраны');

    await moveGrams(client, userId, 0, SPIN_PRICE_NANO, `fragment spin ${item.digits}`);
    await client.query(
      `UPDATE fragment_numbers
       SET owner_user_id = $2, status = 'owned', price_nano = $3, updated_at = now() WHERE id = $1`,
      [String(item.id), String(userId), price.toString()]
    );
    await client.query(
      `INSERT INTO fragment_number_purchases (number_id, buyer_user_id, seller_user_id, amount_nano, kind)
       VALUES ($1, $2, 0, $3, 'spin')`,
      [String(item.id), String(userId), SPIN_PRICE_NANO.toString()]
    );
    await client.query('COMMIT');

    const { rows: result } = await client.query(NUMBER_SELECT + ' WHERE n.id = $1', [String(item.id)]);
    return {
      ok: true,
      costGrams: 10,
      tier: { key: tier.key, label: tier.label, probability: tier.probability, color: tier.color },
      valueGrams: tier.priceGrams,
      number: mapNumber(result[0]),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function sellNumber(userId, numberId, priceGrams) {
  const price = gramsToNano(priceGrams);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM fragment_numbers WHERE id = $1 FOR UPDATE', [String(numberId)]);
    const item = rows[0];
    if (!item) throw Object.assign(new Error('Номер не найден'), { code: 404 });
    if (String(item.owner_user_id) !== String(userId) || item.status !== 'owned') {
      throw new Error('Выставить на продажу можно только свой свободный номер');
    }
    await client.query(
      'UPDATE fragment_numbers SET price_nano = $2, updated_at = now() WHERE id = $1',
      [String(item.id), price]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true, priceGrams: nanoToGrams(price) };
}

export async function createNumberAuction(userId, numberId, startingPrice, durationHours) {
  const price = BigInt(startingPrice);
  const hours = Number(durationHours);
  if (price < 0n) throw new Error('Стартовая цена отрицательная');
  if (!Number.isFinite(hours) || hours < 1 || hours > 720) throw new Error('Срок аукциона от 1 до 720 часов');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM fragment_numbers WHERE id = $1 FOR UPDATE', [String(numberId)]);
    const item = rows[0];
    if (!item) throw Object.assign(new Error('Номер не найден'), { code: 404 });
    if (String(item.owner_user_id) !== String(userId) || item.status !== 'owned') {
      throw new Error('Выставить на аукцион можно только свой свободный номер');
    }
    await client.query(
      "UPDATE fragment_numbers SET status = 'auction', price_nano = 0, updated_at = now() WHERE id = $1",
      [String(item.id)]
    );
    await client.query(
      `INSERT INTO fragment_number_auctions
        (number_id, seller_user_id, starting_price_nano, current_bid_nano, ends_at, status)
       VALUES ($1, $2, $3, $3, now() + ($4::int || ' hours')::interval, 'active')`,
      [String(item.id), String(userId), price.toString(), Math.round(hours)]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

export async function placeNumberBid(userId, auctionId, amount) {
  const bid = BigInt(amount);
  if (bid <= 0n) throw new Error('Ставка должна быть больше нуля');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT a.*, n.digits FROM fragment_number_auctions a
       JOIN fragment_numbers n ON n.id = a.number_id
       WHERE a.id = $1 FOR UPDATE OF a`,
      [String(auctionId)]
    );
    const auction = rows[0];
    if (!auction) throw Object.assign(new Error('Аукцион не найден'), { code: 404 });
    if (auction.status !== 'active' || new Date(auction.ends_at).getTime() <= Date.now()) {
      throw new Error('Аукцион уже завершён');
    }
    if (String(auction.highest_bidder_user_id) === String(userId)) {
      throw new Error('Вы уже держите лучшую ставку');
    }
    if (bid <= toBigInt(auction.current_bid_nano)) throw new Error('Ставка должна быть выше текущей');
    const balance = await balanceFromClient(client, userId);
    if (balance < bid) throw Object.assign(new Error('Недостаточно gram'), { code: 402 });
    await client.query(
      'INSERT INTO fragment_number_bids (auction_id, bidder_user_id, amount_nano) VALUES ($1, $2, $3)',
      [String(auction.id), String(userId), bid.toString()]
    );
    await client.query(
      `UPDATE fragment_number_auctions
       SET current_bid_nano = $2, highest_bidder_user_id = $3 WHERE id = $1`,
      [String(auction.id), bid.toString(), String(userId)]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}

export async function settleAuctions() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT a.*, n.digits FROM fragment_number_auctions a
       JOIN fragment_numbers n ON n.id = a.number_id
       WHERE a.status = 'active' AND a.ends_at <= now()
       FOR UPDATE OF a`
    );
    for (const auction of rows) {
      const winner = String(auction.highest_bidder_user_id || 0);
      const price = toBigInt(auction.current_bid_nano);
      if (winner !== '0' && price > 0n) {
        const balance = await balanceFromClient(client, winner);
        if (balance >= price) {
          await moveGrams(client, winner, auction.seller_user_id, price, `fragment auction ${auction.digits}`);
          await client.query(
            `UPDATE fragment_numbers
             SET owner_user_id = $2, status = 'owned', price_nano = 0, updated_at = now() WHERE id = $1`,
            [String(auction.number_id), winner]
          );
          await client.query(
            `INSERT INTO fragment_number_purchases (number_id, buyer_user_id, seller_user_id, amount_nano, kind)
             VALUES ($1, $2, $3, $4, 'auction')`,
            [String(auction.number_id), winner, String(auction.seller_user_id), price.toString()]
          );
          await client.query("UPDATE fragment_number_auctions SET status = 'settled' WHERE id = $1", [String(auction.id)]);
          continue;
        }
      }
      await client.query(
        "UPDATE fragment_numbers SET status = 'owned', updated_at = now() WHERE id = $1",
        [String(auction.number_id)]
      );
      await client.query("UPDATE fragment_number_auctions SET status = 'cancelled' WHERE id = $1", [String(auction.id)]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getAuctions() {
  await settleAuctions();
  const { rows } = await pool.query(
    NUMBER_SELECT + " WHERE a.id IS NOT NULL ORDER BY a.ends_at LIMIT 200"
  );
  return rows.map(mapNumber);
}
