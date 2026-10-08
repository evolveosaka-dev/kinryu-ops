-- Reference data needed in production (stores, October 2026 targets, holidays).

insert into public.stores (code, name_ja, name_en, sort_order) values
  ('midosuji', '御堂筋店', 'Midosuji', 1),
  ('sennichimae', '千日前店', 'Sennichimae', 2);

-- target_bowls 2026-10: previous-year same-month daily average
insert into public.target_bowls (store_id, month, shift, day_type, bowls)
select s.id, date '2026-10-01', v.shift, v.day_type, v.bowls
from (values
  ('midosuji', 'early', 'weekday', 122), ('midosuji', 'middle', 'weekday', 140), ('midosuji', 'late', 'weekday', 136),
  ('midosuji', 'early', 'weekend_holiday', 201), ('midosuji', 'middle', 'weekend_holiday', 174), ('midosuji', 'late', 'weekend_holiday', 144),
  ('sennichimae', 'early', 'weekday', 187), ('sennichimae', 'middle', 'weekday', 153), ('sennichimae', 'late', 'weekday', 109),
  ('sennichimae', 'early', 'weekend_holiday', 306), ('sennichimae', 'middle', 'weekend_holiday', 214), ('sennichimae', 'late', 'weekend_holiday', 129)
) as v (code, shift, day_type, bowls)
join public.stores s on s.code = v.code;

insert into public.holidays (date, name_ja) values
  ('2026-01-01', '元日'), ('2026-01-12', '成人の日'), ('2026-02-11', '建国記念の日'), ('2026-02-23', '天皇誕生日'),
  ('2026-03-20', '春分の日'), ('2026-04-29', '昭和の日'), ('2026-05-03', '憲法記念日'), ('2026-05-04', 'みどりの日'),
  ('2026-05-05', 'こどもの日'), ('2026-05-06', '振替休日'), ('2026-07-20', '海の日'), ('2026-08-11', '山の日'),
  ('2026-09-21', '敬老の日'), ('2026-09-22', '国民の休日'), ('2026-09-23', '秋分の日'), ('2026-10-12', 'スポーツの日'),
  ('2026-11-03', '文化の日'), ('2026-11-23', '勤労感謝の日'),
  ('2027-01-01', '元日'), ('2027-01-11', '成人の日'), ('2027-02-11', '建国記念の日'), ('2027-02-23', '天皇誕生日'),
  ('2027-03-21', '春分の日'), ('2027-03-22', '振替休日'), ('2027-04-29', '昭和の日'), ('2027-05-03', '憲法記念日'),
  ('2027-05-04', 'みどりの日'), ('2027-05-05', 'こどもの日'), ('2027-07-19', '海の日'), ('2027-08-11', '山の日'),
  ('2027-09-20', '敬老の日'), ('2027-09-23', '秋分の日'), ('2027-10-11', 'スポーツの日'), ('2027-11-03', '文化の日'),
  ('2027-11-23', '勤労感謝の日');

-- The first manager account is added to public.bootstrap_accounts manually (SQL Editor),
-- so no personal e-mail address is kept in this public repository. See docs/SETUP_vi.md §5.
