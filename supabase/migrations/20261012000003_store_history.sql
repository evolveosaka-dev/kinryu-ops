-- 履歴 → 全店舗: every report of one store for one month, with who reported, when and the content.
-- 朝礼: every active user. 巡回: managers only (staff and patrol members see only their own patrols).
-- Test data (is_test) is left out; a test account also sees its own test records.

create or replace function public.store_chorei_month(p_store uuid, p_month date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  manager boolean := public.is_manager();
  tester boolean := public.is_test_account();
begin
  if not public.is_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'business_date', c.business_date, 'shift', c.shift, 'submitted_at', c.submitted_at,
             'leader', coalesce(nullif(l.display_name, ''), l.full_name, ''),
             'participants', coalesce((select array_agg(coalesce(nullif(p.display_name, ''), p.full_name, '')) from public.profiles p where p.id = any(c.participants)), '{}')
                             || c.participants_extra,
             'stock_none', c.stock_none, 'stock_text', c.stock_text, 'target_bowls', c.target_bowls,
             'caution_text', c.caution_text, 'steps_done', c.steps_done, 'skip_reason', c.skip_reason,
             'original_texts', c.original_texts, 'is_test', c.is_test,
             'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'author', coalesce(nullif(a.display_name, ''), a.full_name, ''), 'created_at', n.created_at) order by n.created_at)
                                from public.chorei_notes n join public.profiles a on a.id = n.author_id
                                where n.chorei_id = c.id and (tester or not a.is_test_account)), '[]'),
             'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'drive_url', case when manager then x.drive_url end))
                                      from public.attachments x where x.chorei_id = c.id and x.status = 'uploaded'), '[]'))
           order by c.business_date desc, array_position(array['late', 'middle', 'early'], c.shift))
    from public.chorei_records c join public.profiles l on l.id = c.leader_id
    where c.store_id = p_store and c.business_date >= m and c.business_date < (m + interval '1 month')::date
      and c.status = 'valid'
      and (not c.is_test or (tester and c.by_test_account))
  ), '[]');
end $$;
revoke execute on function public.store_chorei_month(uuid, date) from public, anon;
grant execute on function public.store_chorei_month(uuid, date) to authenticated;

create or replace function public.store_patrol_month(p_store uuid, p_month date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  m date := date_trunc('month', p_month)::date;
  tester boolean := public.is_test_account();
begin
  if not public.is_manager() then
    raise exception 'managers only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(c) - 'patroller_id' - 'follow_up_note' - 'void_reason' || jsonb_build_object(
             'patroller', coalesce(nullif(p.display_name, ''), p.full_name, ''),
             'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'drive_url', x.drive_url))
                                      from public.attachments x where x.patrol_id = c.id and x.status = 'uploaded'), '[]'))
           order by c.business_date desc, c.started_at desc)
    from public.patrol_checks c join public.profiles p on p.id = c.patroller_id
    where c.store_id = p_store and c.business_date >= m and c.business_date < (m + interval '1 month')::date
      and c.status = 'valid'
      and (not c.is_test or (tester and c.by_test_account))
  ), '[]');
end $$;
revoke execute on function public.store_patrol_month(uuid, date) from public, anon;
grant execute on function public.store_patrol_month(uuid, date) to authenticated;
