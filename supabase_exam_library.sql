-- ============================================================
-- KHO ĐỀ LUYỆN VẬT LÍ + QUYỀN GIÁO VIÊN
-- Chạy toàn bộ file này trong Supabase > SQL Editor.
--
-- QUAN TRỌNG:
-- Thêm tất cả email giáo viên vào hàm is_exam_teacher() bên dưới.
-- ============================================================

create or replace function public.is_exam_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'beobeo2035@gmail.com',
    'baelixx68@gmail.com'
    -- Thêm email khác theo mẫu:
    -- , 'giaovien2@gmail.com'
  );
$$;

revoke all on function public.is_exam_teacher() from public;
grant execute on function public.is_exam_teacher() to anon, authenticated;

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text not null default '',
  duration_minutes integer not null default 50
    check (duration_minutes between 10 and 180),
  grade_level text not null default 'THPT',
  is_published boolean not null default false,
  exam_data jsonb not null default
    '{"mcq":[],"trueFalse":[],"shortAnswer":[]}'::jsonb,
  created_by uuid references auth.users(id) on delete set null
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint exams_code_length_check
    check (char_length(trim(code)) between 2 and 40),
  constraint exams_title_length_check
    check (char_length(trim(title)) between 2 and 150),
  constraint exams_data_object_check
    check (jsonb_typeof(exam_data) = 'object'),
  constraint exams_published_structure_check
    check (
      not is_published
      or (
        coalesce(jsonb_array_length(exam_data -> 'mcq'), -1) = 18
        and coalesce(jsonb_array_length(exam_data -> 'trueFalse'), -1) = 4
        and coalesce(jsonb_array_length(exam_data -> 'shortAnswer'), -1) = 6
      )
    )
);

create index if not exists exams_published_created_index
on public.exams (is_published, created_at desc);

alter table public.exams enable row level security;

revoke all on table public.exams from anon, authenticated;
grant select on table public.exams to anon, authenticated;
grant insert, update, delete on table public.exams to authenticated;

drop policy if exists "Published exams are visible" on public.exams;
create policy "Published exams are visible"
on public.exams
for select
to anon, authenticated
using (
  is_published = true
  or public.is_exam_teacher()
);

drop policy if exists "Teachers can create exams" on public.exams;
create policy "Teachers can create exams"
on public.exams
for insert
to authenticated
with check (
  public.is_exam_teacher()
  and created_by = (select auth.uid())
);

drop policy if exists "Teachers can update exams" on public.exams;
create policy "Teachers can update exams"
on public.exams
for update
to authenticated
using (public.is_exam_teacher())
with check (public.is_exam_teacher());

drop policy if exists "Teachers can delete exams" on public.exams;
create policy "Teachers can delete exams"
on public.exams
for delete
to authenticated
using (public.is_exam_teacher());

-- ------------------------------------------------------------
-- Liên kết kết quả học sinh với từng đề.
-- ------------------------------------------------------------

alter table public.exam_attempts
add column if not exists exam_id uuid;

-- Bản cũ giới hạn thời gian 3000 giây (50 phút). Nới lên 180 phút
-- để giáo viên có thể tạo đề với thời lượng khác.
alter table public.exam_attempts
drop constraint if exists exam_attempts_time_used_seconds_check;

alter table public.exam_attempts
add constraint exam_attempts_time_used_seconds_check
check (time_used_seconds between 0 and 10800);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'exam_attempts_exam_id_fkey'
      and conrelid = 'public.exam_attempts'::regclass
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_exam_id_fkey
      foreign key (exam_id)
      references public.exams(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists exam_attempts_exam_id_index
on public.exam_attempts (exam_id);

alter table public.exam_attempts enable row level security;

revoke all on table public.exam_attempts from anon, authenticated;
grant insert on table public.exam_attempts to anon, authenticated;
grant select on table public.exam_attempts to authenticated;

-- Xóa policy cũ chỉ cho mã VL-THPT-01 và thay bằng policy nhiều đề.
drop policy if exists "Students can submit exam results"
on public.exam_attempts;

create policy "Students can submit exam results"
on public.exam_attempts
for insert
to anon, authenticated
with check (
  exam_id is not null
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

-- Đồng bộ policy xem điểm với cùng danh sách giáo viên ở hàm trên.
drop policy if exists "Teacher can read exam results"
on public.exam_attempts;

create policy "Teacher can read exam results"
on public.exam_attempts
for select
to authenticated
using (public.is_exam_teacher());

-- Kiểm tra nhanh sau khi chạy:
select
  (select count(*) from public.exams) as total_exams,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'exams') as exam_policies,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'exam_attempts') as attempt_policies;
