-- シフト希望: requests for month M can be sent or changed until the 20th of month M-1
-- (Tokyo date, inclusive). Managers can still change them. Keep in sync with
-- src/domain/shiftRequest.ts requestDeadline().

create function public.shift_request_deadline(p_month date) returns date
language sql immutable parallel safe set search_path = ''
as $$ select (p_month - interval '1 month' + interval '19 days')::date $$;

drop policy shift_requests_insert on public.shift_requests;
drop policy shift_requests_update on public.shift_requests;

create policy shift_requests_insert on public.shift_requests for insert to authenticated
  with check (public.is_active() and user_id = auth.uid() and public.tokyo_today() <= public.shift_request_deadline(month));
create policy shift_requests_update on public.shift_requests for update to authenticated
  using (public.is_manager() or (public.is_active() and user_id = auth.uid() and public.tokyo_today() <= public.shift_request_deadline(month)))
  with check (public.is_manager() or user_id = auth.uid());
