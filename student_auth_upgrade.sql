-- ============================================================
-- ĐĂNG NHẬP HỌC SINH + HỒ SƠ HỌC SINH + BẢO VỆ KHO ĐỀ
--
-- Yêu cầu: đã chạy file supabase_exam_library.sql trước đó.
-- Chạy toàn bộ file này trong Supabase > SQL Editor > Run.
-- ============================================================

-- 1. Hồ sơ học sinh nằm trong public schema để website có thể đọc qua API.
create table if not exists public.student_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  class_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint student_profiles_name_check
    check (char_length(trim(full_name)) between 2 and 80),
  constraint student_profiles_class_check
    check (char_length(trim(class_name)) between 1 and 20)
);

create index if not exists student_profiles_class_name_index
on public.student_profiles (class_name);

alter table public.student_profiles enable row level security;

revoke all on table public.student_profiles from anon, authenticated;
grant select, insert, update on table public.student_profiles to authenticated;

-- Học sinh chỉ được xem hồ sơ của mình; giáo viên xem được toàn bộ hồ sơ.
drop policy if exists "Students read own profile" on public.student_profiles;
create policy "Students read own profile"
on public.student_profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.is_exam_teacher()
);

-- Cho phép client tạo hồ sơ dự phòng nếu trigger chưa tạo được.
drop policy if exists "Students create own profile" on public.student_profiles;
create policy "Students create own profile"
on public.student_profiles
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and not public.is_exam_teacher()
);

-- Học sinh được sửa tên/lớp của chính mình.
drop policy if exists "Students update own profile" on public.student_profiles;
create policy "Students update own profile"
on public.student_profiles
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- 2. Tự tạo hồ sơ khi học sinh đăng ký qua website.
create or replace function public.handle_new_exam_student()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') = 'student' then
    insert into public.student_profiles (user_id, full_name, class_name)
    values (
      new.id,
      trim(coalesce(new.raw_user_meta_data ->> 'full_name', 'Học sinh')),
      upper(trim(coalesce(new.raw_user_meta_data ->> 'class_name', 'THPT')))
    )
    on conflict (user_id) do update
    set
      full_name = excluded.full_name,
      class_name = excluded.class_name,
      updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_exam_student() from public;

drop trigger if exists on_exam_student_created on auth.users;
create trigger on_exam_student_created
after insert on auth.users
for each row execute procedure public.handle_new_exam_student();

-- 3. Chỉ người đã đăng nhập mới xem được kho đề.
revoke select on table public.exams from anon;
grant select on table public.exams to authenticated;

drop policy if exists "Published exams are visible" on public.exams;
create policy "Published exams are visible"
on public.exams
for select
to authenticated
using (
  is_published = true
  or public.is_exam_teacher()
);

-- 4. Gắn mỗi kết quả với tài khoản học sinh đã đăng nhập.
alter table public.exam_attempts
add column if not exists student_user_id uuid;

alter table public.exam_attempts
alter column student_user_id set default auth.uid();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'exam_attempts_student_user_id_fkey'
      and conrelid = 'public.exam_attempts'::regclass
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_student_user_id_fkey
      foreign key (student_user_id)
      references auth.users(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists exam_attempts_student_user_id_index
on public.exam_attempts (student_user_id, submitted_at desc);

alter table public.exam_attempts enable row level security;

revoke all on table public.exam_attempts from anon, authenticated;
grant insert, select on table public.exam_attempts to authenticated;

-- Không còn cho khách chưa đăng nhập nộp điểm.
drop policy if exists "Students can submit exam results"
on public.exam_attempts;

create policy "Students can submit exam results"
on public.exam_attempts
for insert
to authenticated
with check (
  student_user_id = (select auth.uid())
  and not public.is_exam_teacher()
  and exam_id is not null
  and exists (
    select 1
    from public.exams e
    where e.id = exam_id
      and e.code = exam_code
      and e.is_published = true
  )
  and char_length(trim(student_name)) between 2 and 80
  and char_length(trim(class_name)) between 1 and 20
  and score between 0 and 10
  and time_used_seconds between 0 and 10800
);

-- Giáo viên xem mọi kết quả; học sinh chỉ xem kết quả của chính mình.
drop policy if exists "Teacher can read exam results"
on public.exam_attempts;

drop policy if exists "Teachers and students read exam results"
on public.exam_attempts;

create policy "Teachers and students read exam results"
on public.exam_attempts
for select
to authenticated
using (
  public.is_exam_teacher()
  or student_user_id = (select auth.uid())
);

-- 5. Kiểm tra nhanh sau khi chạy.
select
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'student_profiles') as student_profile_policies,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'exams') as exam_policies,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'exam_attempts') as attempt_policies;
