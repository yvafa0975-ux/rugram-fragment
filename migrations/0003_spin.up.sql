-- RuGram Fragment: рулетка номеров +888 за 10 gram.

ALTER TABLE fragment_number_purchases
    DROP CONSTRAINT IF EXISTS fragment_number_purchases_kind_check;
ALTER TABLE fragment_number_purchases
    ADD CONSTRAINT fragment_number_purchases_kind_check
    CHECK (kind IN ('buy', 'auction', 'spin'));
