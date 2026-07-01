-- Auto-provision a profile + personal org for every new auth user.
-- Mirrors the app-side ensureProfileAndOrg() fallback, but runs in the DB so
-- provisioning is guaranteed at signup regardless of which code path runs.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  -- Mirror the auth user into public.profiles
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  -- Create a personal org the first time we see this user
  if not exists (select 1 from public.org_members where user_id = new.id) then
    insert into public.orgs (name)
    values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'Workspace') || '''s workspace')
    returning id into new_org_id;

    insert into public.org_members (org_id, user_id, role)
    values (new_org_id, new.id, 'owner');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
