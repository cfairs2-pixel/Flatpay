-- myflatpay / Supabase. Run once in the SQL editor or with supabase db push.
-- Private account data is accessible only through the authenticated RPC below.
begin;

create table public.flatpay_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision_counter bigint not null default 0 check (revision_counter >= 0)
);
create table public.flatpay_deals (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9-]{1,100}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create table public.flatpay_assistant (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null check (revision > 0)
);
create table public.flatpay_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('daily','manual','before-delete','before-restore')),
  created_at timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);
create index flatpay_deals_updated on public.flatpay_deals(owner_id, updated_at desc);
create index flatpay_backups_owner on public.flatpay_backups(owner_id, created_at desc);

alter table public.flatpay_accounts enable row level security;
alter table public.flatpay_deals enable row level security;
alter table public.flatpay_assistant enable row level security;
alter table public.flatpay_backups enable row level security;
create policy flatpay_accounts_owner on public.flatpay_accounts to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy flatpay_deals_owner on public.flatpay_deals to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy flatpay_assistant_owner on public.flatpay_assistant to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy flatpay_backups_owner on public.flatpay_backups to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- Writes must pass the RPC so quota, validation and revision checks cannot be skipped.
revoke all on public.flatpay_accounts, public.flatpay_deals, public.flatpay_assistant, public.flatpay_backups from public, anon, authenticated;
grant select on public.flatpay_deals, public.flatpay_assistant, public.flatpay_backups to authenticated;

create function public._flatpay_empty_assistant() returns jsonb language sql immutable set search_path = '' as $$
  select '{"version":1,"messages":[],"preferences":[],"targets":{"sales":null,"commission":null}}'::jsonb
$$;

create function public._flatpay_validate_deal(candidate jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  item jsonb;
  value jsonb;
  field text;
  seen text[] := array[]::text[];
  result jsonb;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' then raise exception '400:Each customer must be a JSON object.'; end if;
  result := '{"status":"Lead","offers":[],"checklist":{},"saleInfo":{},"commissionDetails":{},"meetingNotes":[]}'::jsonb
    || (candidate - array['id','_revision','createdAt','updatedAt','ownerId','owner_id','userId','user_id']);
  if jsonb_typeof(result->'businessName') is distinct from 'string' or length(btrim(result->>'businessName')) = 0 or length(result->>'businessName') > 300 then raise exception '400:A customer trading name of 1–300 characters is required.'; end if;
  if jsonb_typeof(result->'status') = 'string' then
    result := jsonb_set(result,'{status}',to_jsonb(case lower(result->>'status')
      when 'lead' then 'Lead' when 'meeting booked' then 'Meeting booked' when 'proposal sent' then 'Proposal sent'
      when 'negotiation' then 'Negotiation' when 'won' then 'Won' when 'lost' then 'Lost' else result->>'status' end));
  end if;
  if jsonb_typeof(result->'status') is distinct from 'string' or (result->>'status') not in ('Lead','Meeting booked','Proposal sent','Negotiation','Won','Lost') then raise exception '400:Choose a valid customer status.'; end if;
  foreach field in array array['contactName','contactEmail','contactPhone','email','phone','provider','initials','color'] loop
    if result ? field and result->field <> 'null'::jsonb and (jsonb_typeof(result->field) <> 'string' or length(result->>field) > 300) then raise exception '400:Customer contact fields must be text of at most 300 characters.'; end if;
  end loop;
  if result ? 'notes' and result->'notes' <> 'null'::jsonb and (jsonb_typeof(result->'notes') <> 'string' or length(result->>'notes') > 10000) then raise exception '400:Customer notes must be text of at most 10,000 characters.'; end if;
  foreach field in array array['monthlyVolume','currentCharges','monthlyCharges','monthlyFees','amexVolume','businessVolume','internationalVolume','amexRate','currentRate','proposedRate','confirmedCommission','commissionAmount'] loop
    value := result->field;
    if value is not null and value <> 'null'::jsonb and value <> '""'::jsonb then
      if jsonb_typeof(value) <> 'number' then raise exception '400:Customer amounts and rates must be non-negative numbers.'; end if;
      if (value::text)::numeric < 0 or (value::text)::numeric > 1000000000000 then raise exception '400:Customer amounts and rates are outside the supported range.'; end if;
      if field in ('amexRate','currentRate','proposedRate') and (value::text)::numeric > 100 then raise exception '400:Rates cannot exceed 100 percent.'; end if;
    end if;
  end loop;
  foreach field in array array['meetingDate','saleDate','nextFollowUpDate'] loop
    value := result->field;
    if value is not null and value not in ('null'::jsonb,'""'::jsonb) then
      if jsonb_typeof(value) <> 'string' or (result->>field) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception '400:Customer dates must use YYYY-MM-DD.'; end if;
      begin
        if to_char((result->>field)::date,'YYYY-MM-DD') <> result->>field then raise exception 'Invalid date'; end if;
      exception when others then raise exception '400:Customer dates must be real calendar dates.';
      end;
    end if;
  end loop;
  if result->>'status' = 'Won' and coalesce(result->>'saleDate','') = '' then raise exception '400:A won sale requires a sale date.'; end if;
  if result ? 'commissionConfirmed' and jsonb_typeof(result->'commissionConfirmed') <> 'boolean' then raise exception '400:Commission confirmation must be true or false.'; end if;
  if result->'commissionConfirmed' = 'true'::jsonb and (result->'commissionAmount' is null or jsonb_typeof(result->'commissionAmount') <> 'number') then raise exception '400:Enter the confirmed commission amount.'; end if;
  foreach field in array array['saleInfo','checklist','commissionDetails'] loop
    if jsonb_typeof(result->field) is distinct from 'object' then raise exception '400:Customer checklist and sale details must be objects.'; end if;
  end loop;
  if exists (select 1 from jsonb_each(result->'checklist') as entry where jsonb_typeof(entry.value) <> 'boolean') then raise exception '400:Checklist entries must be true or false.'; end if;
  if jsonb_typeof(result->'offers') is distinct from 'array' or jsonb_typeof(result->'meetingNotes') is distinct from 'array' then raise exception '400:Offers and meeting notes must be lists.'; end if;
  if jsonb_array_length(result->'offers') > 100 or jsonb_array_length(result->'meetingNotes') > 200 then raise exception '400:This customer contains too many offers or meeting notes.'; end if;
  for item in select * from jsonb_array_elements(result->'offers') loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'id') is distinct from 'string' or (item->>'id') !~ '^[A-Za-z0-9-]{1,100}$' or (item->>'id') = any(seen) then raise exception '400:Each offer needs a unique valid ID.'; end if;
    seen := array_append(seen,item->>'id');
    foreach field in array array['rate','amexRate','monthlyFee','terminalCount','premiumCount','proCount'] loop
      value := item->field;
      if value is not null and value <> 'null'::jsonb and value <> '""'::jsonb then
        if jsonb_typeof(value) <> 'number' then raise exception '400:Offer amounts and quantities must be numbers.'; end if;
        if (value::text)::numeric < 0 or (value::text)::numeric > 1000000000000 then raise exception '400:Offer amounts are outside the supported range.'; end if;
        if field in ('rate','amexRate') and (value::text)::numeric > 100 then raise exception '400:Offer rates cannot exceed 100 percent.'; end if;
      end if;
    end loop;
  end loop;
  for item in select * from jsonb_array_elements(result->'meetingNotes') loop
    if jsonb_typeof(item) <> 'object' then raise exception '400:Meeting notes must contain objects.'; end if;
    foreach field in array array['id','title','date','body','nextFollowUp'] loop
      if item ? field and item->field <> 'null'::jsonb and (jsonb_typeof(item->field) <> 'string' or length(item->>field) > 20000) then raise exception '400:Meeting note fields must contain bounded text.'; end if;
    end loop;
    if item ? 'actions' and item->'actions' <> 'null'::jsonb then
      if jsonb_typeof(item->'actions') = 'array' then
        if jsonb_array_length(item->'actions') > 100 then raise exception '400:A meeting note has too many actions.'; end if;
        for value in select * from jsonb_array_elements(item->'actions') loop
          if jsonb_typeof(value) <> 'string' or length(value #>> '{}') > 20000 then raise exception '400:Meeting note actions must contain bounded text.'; end if;
        end loop;
      elsif jsonb_typeof(item->'actions') <> 'string' or length(item->>'actions') > 20000 then raise exception '400:Meeting note actions must contain bounded text.';
      end if;
    end if;
  end loop;
  if result ? 'selectedOfferId' and result->'selectedOfferId' not in ('null'::jsonb,'""'::jsonb) and not ((result->>'selectedOfferId') = any(seen)) then raise exception '400:The selected offer must belong to this customer.'; end if;
  if octet_length(result::text) > 1048576 then raise exception '413:A customer exceeds the 1 MB limit.'; end if;
  return result;
end
$$;

create function public._flatpay_validate_assistant(candidate jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  item jsonb;
  action jsonb;
  marker jsonb;
  field text;
  seen text[] := array[]::text[];
  action_count integer;
  state jsonb;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' then raise exception '400:Assistant state must be an object.'; end if;
  state := candidate - array['_revision','owner_id','ownerId','userId','user_id'];
  if jsonb_typeof(state->'messages') is distinct from 'array' or jsonb_typeof(state->'preferences') is distinct from 'array' or jsonb_typeof(state->'targets') is distinct from 'object' then raise exception '400:Assistant state needs messages, preferences and targets.'; end if;
  if jsonb_array_length(state->'messages') > 200 or jsonb_array_length(state->'preferences') > 30 then raise exception '400:Assistant state contains too many entries.'; end if;
  foreach field in array array['sales','commission'] loop
    if not (state->'targets' ? field) then raise exception '400:Assistant targets need sales and commission values.'; end if;
    if state->'targets' ? field and state->'targets'->field <> 'null'::jsonb then
      if jsonb_typeof(state->'targets'->field) <> 'number' then raise exception '400:Assistant targets must be non-negative numbers.'; end if;
      if (state->'targets'->>field)::numeric < 0 or (state->'targets'->>field)::numeric > 1000000000 then raise exception '400:Assistant targets are outside the supported range.'; end if;
      if field = 'sales' and (state->'targets'->>field)::numeric <> trunc((state->'targets'->>field)::numeric) then raise exception '400:The sales target must be a whole number.'; end if;
    end if;
  end loop;
  for item in select * from jsonb_array_elements(state->'preferences') loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'id') is distinct from 'string' or (item->>'id') !~ '^[A-Za-z0-9-]{1,100}$' or (item->>'id') = any(seen) or jsonb_typeof(item->'text') is distinct from 'string' or length(btrim(item->>'text')) = 0 or length(item->>'text') > 1000 then raise exception '400:Assistant preferences must contain unique IDs and 1–1,000 characters of text.'; end if;
    seen := array_append(seen,item->>'id');
  end loop;
  seen := array[]::text[];
  for item in select * from jsonb_array_elements(state->'messages') loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'id') is distinct from 'string' or (item->>'id') !~ '^[A-Za-z0-9-]{1,100}$' or (item->>'id') = any(seen) or jsonb_typeof(item->'role') is distinct from 'string' or (item->>'role') not in ('user','assistant') or jsonb_typeof(item->'content') is distinct from 'string' or length(item->>'content') > 20000 then raise exception '400:Assistant messages contain an invalid entry.'; end if;
    seen := array_append(seen,item->>'id');
    if item ? 'dealId' and item->'dealId' <> 'null'::jsonb and (jsonb_typeof(item->'dealId') <> 'string' or (item->>'dealId') !~ '^[A-Za-z0-9-]{1,100}$') then raise exception '400:Assistant message has an invalid customer reference.'; end if;
    if item ? 'actions' then
      if jsonb_typeof(item->'actions') <> 'array' then raise exception '400:Assistant message actions must be a list.'; end if;
      if jsonb_array_length(item->'actions') > 100 then raise exception '400:Assistant message has too many actions.'; end if;
      for action in select * from jsonb_array_elements(item->'actions') loop
        if jsonb_typeof(action) <> 'object' or jsonb_typeof(action->'type') is distinct from 'string' or (action->>'type') not in ('note','followUp') or jsonb_typeof(action->'text') is distinct from 'string' or length(action->>'text') > 20000 then raise exception '400:Assistant message has an invalid action.'; end if;
      end loop;
    end if;
    if item ? 'applied' then
      if jsonb_typeof(item->'applied') <> 'array' then raise exception '400:Assistant applied actions must be a list.'; end if;
      action_count := case when item ? 'actions' then jsonb_array_length(item->'actions') else 0 end;
      if jsonb_array_length(item->'applied') > action_count then raise exception '400:Assistant applied-action markers are invalid.'; end if;
      for marker in select * from jsonb_array_elements(item->'applied') loop
        if jsonb_typeof(marker) <> 'number' or marker::text !~ '^[0-9]+$' then raise exception '400:Assistant applied-action markers must be valid indices.'; end if;
        if (marker::text)::numeric >= action_count then raise exception '400:Assistant applied-action marker is out of range.'; end if;
      end loop;
    end if;
  end loop;
  return state || jsonb_build_object('version',1);
end
$$;

create function public._flatpay_assistant(owner uuid) returns jsonb language sql stable set search_path = '' as $$
  select coalesce((select payload || jsonb_build_object('_revision',revision) from public.flatpay_assistant where owner_id=owner), public._flatpay_empty_assistant() || '{"_revision":0}'::jsonb)
$$;
create function public._flatpay_export(owner uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('version',1,'exportedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deals',coalesce((select jsonb_agg(payload || jsonb_build_object('_revision',revision) order by updated_at desc,id) from public.flatpay_deals where owner_id=owner),'[]'::jsonb),
    'assistant',public._flatpay_assistant(owner) - '_revision')
$$;
create function public._flatpay_quota(owner uuid) returns void language plpgsql set search_path = '' as $$
declare size_bytes bigint;
begin
  if (select count(*) from public.flatpay_deals where owner_id=owner) > 2000 then raise exception '400:A workspace supports up to 2,000 customers.'; end if;
  -- Use the same canonical wrapper as backup validation so every valid workspace can round-trip.
  select octet_length(jsonb_build_object(
    'deals',coalesce((select jsonb_agg(payload order by updated_at desc,id) from public.flatpay_deals where owner_id=owner),'[]'::jsonb),
    'assistant',public._flatpay_assistant(owner) - '_revision'
  )::text) into size_bytes;
  if size_bytes > 10485760 then raise exception '413:The workspace exceeds the 10 MB database limit.'; end if;
end
$$;
create function public._flatpay_snapshot(owner uuid, why text) returns jsonb language plpgsql set search_path = '' as $$
declare new_id uuid; saved_at timestamptz; saved jsonb;
begin
  saved := public._flatpay_export(owner);
  insert into public.flatpay_backups(owner_id,reason,payload) values(owner,why,saved) returning id,created_at into new_id,saved_at;
  delete from public.flatpay_backups where owner_id=owner and id not in (select id from public.flatpay_backups where owner_id=owner order by created_at desc,id desc limit 60);
  return jsonb_build_object('id',new_id,'createdAt',saved_at,'reason',why,'bytes',octet_length(saved::text));
end
$$;
create function public._flatpay_daily(owner uuid) returns void language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from public.flatpay_backups where owner_id=owner and reason='daily' and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') then perform public._flatpay_snapshot(owner,'daily'); end if;
end
$$;
create function public._flatpay_validate_backup(candidate jsonb) returns jsonb language plpgsql stable set search_path = '' as $$
declare item jsonb; deal jsonb; deals jsonb := '[]'::jsonb; seen text[] := array[]::text[]; row_id text; assistant jsonb;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' or candidate->'version' is distinct from '1'::jsonb or jsonb_typeof(candidate->'deals') is distinct from 'array' then raise exception '400:Choose a version 1 myflatpay JSON backup.'; end if;
  if jsonb_array_length(candidate->'deals') > 2000 then raise exception '400:The backup contains more than 2,000 customers.'; end if;
  for item in select * from jsonb_array_elements(candidate->'deals') loop
    deal := public._flatpay_validate_deal(item);
    row_id := item->>'id';
    if row_id is null or jsonb_typeof(item->'id') <> 'string' or row_id !~ '^[A-Za-z0-9-]{1,100}$' or row_id = any(seen) then raise exception '400:The backup contains an invalid or duplicate customer ID.'; end if;
    seen := array_append(seen,row_id);
    -- Imported date metadata is bounded text; invalid dates fall back to restore time.
    deal := deal || jsonb_build_object('id',row_id,'createdAt',case when jsonb_typeof(item->'createdAt')='string' and length(item->>'createdAt') < 50 then item->>'createdAt' else to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'updatedAt',case when jsonb_typeof(item->'updatedAt')='string' and length(item->>'updatedAt') < 50 then item->>'updatedAt' else to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end);
    deals := deals || jsonb_build_array(deal);
  end loop;
  assistant := case when candidate ? 'assistant' then public._flatpay_validate_assistant(candidate->'assistant') else public._flatpay_empty_assistant() end;
  if octet_length(jsonb_build_object('deals',deals,'assistant',assistant)::text) > 10485760 then raise exception '413:The backup exceeds the 10 MB database limit.'; end if;
  return jsonb_build_object('version',1,'deals',deals,'assistant',assistant);
end
$$;

create function public.flatpay_workspace(operation text, input jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '15s' as $$
declare
  owner uuid := auth.uid();
  state jsonb;
  candidate jsonb;
  previous jsonb;
  checked jsonb;
  result jsonb;
  recovery jsonb;
  item jsonb;
  row_id text;
  revision_value bigint;
  previous_revision bigint;
  expected text;
  stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if owner is null then raise exception '401:Sign in to access your workspace.' using errcode='42501'; end if;
  if input is null or jsonb_typeof(input) <> 'object' then raise exception '400:RPC input must be a JSON object.'; end if;
  if octet_length(input::text) > 12582912 then raise exception '413:This upload exceeds the 12 MB transport limit.'; end if;
  -- One row lock serializes an account's mutations; distinct accounts remain independent.
  insert into public.flatpay_accounts(owner_id) values(owner) on conflict do nothing;
  perform 1 from public.flatpay_accounts where owner_id=owner for update;

  if operation = 'deals.list' then
    return coalesce((select jsonb_agg(payload || jsonb_build_object('_revision',revision) order by updated_at desc,id) from public.flatpay_deals where owner_id=owner),'[]'::jsonb);
  elsif operation = 'deals.save' then
    candidate := public._flatpay_validate_deal(input->'deal');
    row_id := input->>'id';
    if row_id is not null then
      if row_id !~ '^[A-Za-z0-9-]{1,100}$' then raise exception '400:Invalid customer ID.'; end if;
      select payload,revision into previous,previous_revision from public.flatpay_deals where owner_id=owner and id=row_id;
      if previous is null then raise exception '404:Customer was not found.'; end if;
      expected := input->'deal'->>'_revision';
      if expected is null or expected !~ '^[0-9]{1,18}$' then raise exception '409:This customer changed on another device. Refresh before editing.'; end if;
      if expected::bigint <> previous_revision then raise exception '409:This customer changed on another device. Refresh before editing.'; end if;
    else row_id := gen_random_uuid()::text;
    end if;
    perform public._flatpay_daily(owner);
    update public.flatpay_accounts set revision_counter=revision_counter+1 where owner_id=owner returning revision_counter into revision_value;
    candidate := candidate || jsonb_build_object('id',row_id,'createdAt',coalesce(previous->>'createdAt',stamp),'updatedAt',stamp);
    insert into public.flatpay_deals(owner_id,id,payload,revision,updated_at) values(owner,row_id,candidate,revision_value,clock_timestamp())
      on conflict(owner_id,id) do update set payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at;
    perform public._flatpay_quota(owner);
    return candidate || jsonb_build_object('_revision',revision_value);
  elsif operation = 'deals.delete' then
    row_id := input->>'id';
    select revision into previous_revision from public.flatpay_deals where owner_id=owner and id=row_id;
    if previous_revision is null then raise exception '404:Customer was not found.'; end if;
    expected := input->>'revision';
    if expected is null or expected !~ '^[0-9]{1,18}$' then raise exception '409:Refresh this customer before deleting it.'; end if;
    if expected::bigint <> previous_revision then raise exception '409:This customer changed on another device. Refresh before deleting it.'; end if;
    perform public._flatpay_snapshot(owner,'before-delete');
    delete from public.flatpay_deals where owner_id=owner and id=row_id and revision=previous_revision;
    return '{"ok":true}'::jsonb;
  elsif operation = 'assistant.get' then
    return public._flatpay_assistant(owner) || '{"mode":"local","model":null,"storage":"server"}'::jsonb;
  elsif operation = 'assistant.set' then
    state := public._flatpay_validate_assistant(input->'state');
    select revision into previous_revision from public.flatpay_assistant where owner_id=owner;
    expected := input->'state'->>'_revision';
    if expected is null or expected !~ '^[0-9]{1,18}$' then raise exception '409:Assistant state changed on another device. Refresh and try again.'; end if;
    if expected::bigint <> coalesce(previous_revision,0) then raise exception '409:Assistant state changed on another device. Refresh and try again.'; end if;
    perform public._flatpay_daily(owner);
    update public.flatpay_accounts set revision_counter=revision_counter+1 where owner_id=owner returning revision_counter into revision_value;
    insert into public.flatpay_assistant(owner_id,payload,revision) values(owner,state,revision_value) on conflict(owner_id) do update set payload=excluded.payload,revision=excluded.revision;
    perform public._flatpay_quota(owner);
    return state || jsonb_build_object('_revision',revision_value,'mode','local','model',null,'storage','server');
  elsif operation = 'export' then return public._flatpay_export(owner);
  elsif operation = 'backups.list' then
    return jsonb_build_object('backups',coalesce((select jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at,'reason',reason,'bytes',octet_length(payload::text)) order by created_at desc,id) from public.flatpay_backups where owner_id=owner),'[]'::jsonb));
  elsif operation = 'backups.create' then return public._flatpay_snapshot(owner,'manual');
  elsif operation = 'backups.get' then
    if coalesce(input->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception '404:Backup was not found.'; end if;
    select payload into result from public.flatpay_backups where owner_id=owner and id=(input->>'id')::uuid;
    if result is null then raise exception '404:Backup was not found.'; end if;
    return result;
  elsif operation in ('backups.preview','backups.restore') then
    checked := public._flatpay_validate_backup(input->'backup');
    if operation = 'backups.preview' then
      return jsonb_build_object('dealCount',jsonb_array_length(checked->'deals'),'assistantMessages',jsonb_array_length(checked->'assistant'->'messages'),'preferences',jsonb_array_length(checked->'assistant'->'preferences'),'assistantIncluded',(input->'backup' ? 'assistant'),'replacesWorkspace',true);
    end if;
    if input->>'confirm' is distinct from 'REPLACE MY WORKSPACE' then raise exception '400:Confirm replacement of your workspace before restoring.'; end if;
    if not (input->'backup' ? 'assistant') then checked := jsonb_set(checked,'{assistant}',public._flatpay_assistant(owner) - '_revision'); end if;
    recovery := public._flatpay_snapshot(owner,'before-restore');
    delete from public.flatpay_deals where owner_id=owner;
    for item in select * from jsonb_array_elements(checked->'deals') loop
      update public.flatpay_accounts set revision_counter=revision_counter+1 where owner_id=owner returning revision_counter into revision_value;
      insert into public.flatpay_deals(owner_id,id,payload,revision,updated_at) values(owner,item->>'id',item,revision_value,clock_timestamp());
    end loop;
    update public.flatpay_accounts set revision_counter=revision_counter+1 where owner_id=owner returning revision_counter into revision_value;
    insert into public.flatpay_assistant(owner_id,payload,revision) values(owner,checked->'assistant',revision_value) on conflict(owner_id) do update set payload=excluded.payload,revision=excluded.revision;
    perform public._flatpay_quota(owner);
    return jsonb_build_object('ok',true,'restored',jsonb_array_length(checked->'deals'),'recoveryBackup',recovery->>'id');
  else raise exception '404:Workspace operation was not found.';
  end if;
end
$$;

-- Helpers are implementation details, never callable with a visitor's supplied owner ID.
revoke all on function public._flatpay_empty_assistant() from public,anon,authenticated;
revoke all on function public._flatpay_validate_deal(jsonb) from public,anon,authenticated;
revoke all on function public._flatpay_validate_assistant(jsonb) from public,anon,authenticated;
revoke all on function public._flatpay_assistant(uuid) from public,anon,authenticated;
revoke all on function public._flatpay_export(uuid) from public,anon,authenticated;
revoke all on function public._flatpay_quota(uuid) from public,anon,authenticated;
revoke all on function public._flatpay_snapshot(uuid,text) from public,anon,authenticated;
revoke all on function public._flatpay_daily(uuid) from public,anon,authenticated;
revoke all on function public._flatpay_validate_backup(jsonb) from public,anon,authenticated;
revoke all on function public.flatpay_workspace(text,jsonb) from public,anon,authenticated;
grant execute on function public.flatpay_workspace(text,jsonb) to authenticated;

comment on function public.flatpay_workspace(text,jsonb) is 'Account-scoped myflatpay API. Uses authenticated auth.uid(), validates writes, prevents stale revisions, and creates recovery history.';
commit;
