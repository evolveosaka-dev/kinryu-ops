-- 巡回 ⑥ お客様の満足度 (not part of the score):
--   「帰るお客様は満足そうでしたか？」 はい / いいえ (a reason is required for いいえ), or お客様がいない.
-- Records sent before this change keep null (not asked); the form requires an answer for new ones.

alter table public.patrol_checks
  add column customer_none boolean not null default false,
  add column customer_satisfied boolean,
  add column customer_reason text,
  add constraint patrol_customer_none_no_answer check (not (customer_none and customer_satisfied is not null)),
  add constraint patrol_customer_reason_for_no check (customer_satisfied is distinct from false or nullif(btrim(customer_reason), '') is not null);
