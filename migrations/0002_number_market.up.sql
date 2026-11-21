-- RuGram Fragment: рынок номеров вместо рынка юзернеймов.
-- Юзернеймов как актива не существует: все старые таблицы удаляются.

DROP TABLE IF EXISTS fragment_purchases CASCADE;
DROP TABLE IF EXISTS fragment_bids CASCADE;
DROP TABLE IF EXISTS fragment_auctions CASCADE;
DROP TABLE IF EXISTS fragment_username_listings CASCADE;

CREATE TABLE IF NOT EXISTS fragment_numbers (
    id bigserial PRIMARY KEY,
    digits text NOT NULL UNIQUE CHECK (digits ~ '^[0-9]{4,12}$'),
    prefix text NOT NULL CHECK (prefix IN ('7', '888')),
    owner_user_id bigint NOT NULL DEFAULT 0 CHECK (owner_user_id >= 0),
    status text NOT NULL DEFAULT 'vault' CHECK (status IN ('vault', 'owned', 'auction')),
    price_nano bigint NOT NULL DEFAULT 0 CHECK (price_nano >= 0),
    rarity integer NOT NULL DEFAULT 0 CHECK (rarity >= 0 AND rarity <= 100),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fragment_numbers_prefix_idx ON fragment_numbers (prefix, status);
CREATE INDEX IF NOT EXISTS fragment_numbers_owner_idx ON fragment_numbers (owner_user_id, status);
ALTER TABLE fragment_numbers ADD COLUMN IF NOT EXISTS rarity integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS fragment_number_auctions (
    id bigserial PRIMARY KEY,
    number_id bigint NOT NULL REFERENCES fragment_numbers(id) ON DELETE CASCADE,
    seller_user_id bigint NOT NULL,
    starting_price_nano bigint NOT NULL CHECK (starting_price_nano >= 0),
    current_bid_nano bigint NOT NULL CHECK (current_bid_nano >= 0),
    highest_bidder_user_id bigint NOT NULL DEFAULT 0,
    ends_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fragment_number_auctions_status_idx
    ON fragment_number_auctions (status, ends_at);

CREATE TABLE IF NOT EXISTS fragment_number_bids (
    id bigserial PRIMARY KEY,
    auction_id bigint NOT NULL REFERENCES fragment_number_auctions(id) ON DELETE CASCADE,
    bidder_user_id bigint NOT NULL,
    amount_nano bigint NOT NULL CHECK (amount_nano > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fragment_number_bids_auction_idx
    ON fragment_number_bids (auction_id, amount_nano DESC);

CREATE TABLE IF NOT EXISTS fragment_number_purchases (
    id bigserial PRIMARY KEY,
    number_id bigint NOT NULL REFERENCES fragment_numbers(id) ON DELETE CASCADE,
    buyer_user_id bigint NOT NULL,
    seller_user_id bigint NOT NULL DEFAULT 0,
    amount_nano bigint NOT NULL,
    kind text NOT NULL CHECK (kind IN ('buy', 'auction')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fragment_number_purchases_buyer_idx
    ON fragment_number_purchases (buyer_user_id, id DESC);

-- Стартовый каталог: красивые номера в хранилище.
INSERT INTO fragment_numbers (digits, prefix, status, price_nano, rarity) VALUES
    ('7777777777', '7', 'vault', 900000000000, 96),
    ('8888888888', '7', 'vault', 800000000000, 94),
    ('1234567890', '7', 'vault', 650000000000, 90),
    ('5555555555', '7', 'vault', 500000000000, 88),
    ('9000000000', '7', 'vault', 320000000000, 82),
    ('7770007777', '7', 'vault', 280000000000, 80),
    ('9999999999', '7', 'vault', 260000000000, 78),
    ('1231231234', '7', 'vault', 180000000000, 72),
    ('5050505050', '7', 'vault', 150000000000, 70),
    ('1000000001', '7', 'vault', 140000000000, 68),
    ('7000000007', '7', 'vault', 130000000000, 66),
    ('3334445555', '7', 'vault', 95000000000, 60),
    ('8888888', '888', 'vault', 750000000000, 98),
    ('888000888', '888', 'vault', 480000000000, 92),
    ('888123456', '888', 'vault', 360000000000, 86),
    ('888777777', '888', 'vault', 340000000000, 84),
    ('888555555', '888', 'vault', 260000000000, 76),
    ('888111111', '888', 'vault', 240000000000, 74),
    ('888888888888', '888', 'vault', 220000000000, 72),
    ('888123123', '888', 'vault', 160000000000, 68),
    ('888505050', '888', 'vault', 140000000000, 64),
    ('8880000000', '888', 'vault', 120000000000, 62)
ON CONFLICT (digits) DO NOTHING;
