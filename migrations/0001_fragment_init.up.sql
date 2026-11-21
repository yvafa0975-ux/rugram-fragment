-- RuGram Fragment demo: собственные таблицы в той же базе RuGram.
-- Префикс fragment_ исключает пересечение с миграциями сервера.
-- Рынок номеров создаётся миграцией 0002; юзернеймов как актива нет.

CREATE TABLE IF NOT EXISTS fragment_sessions (
    token text PRIMARY KEY,
    user_id bigint NOT NULL,
    phone text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS fragment_sessions_user_idx ON fragment_sessions (user_id);
