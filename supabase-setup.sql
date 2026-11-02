-- ============================================================
-- EduGame — ตั้งค่า Supabase (รันครั้งเดียว)
-- วิธีใช้: Supabase Dashboard > SQL Editor > New query > วางไฟล์นี้ทั้งหมด > Run
-- ============================================================

-- 1) ตารางเก็บชุดคำถามของครูแต่ละคน
create table if not exists public.question_sets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text not null default '',
  questions   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists question_sets_user_idx on public.question_sets (user_id, updated_at desc);

-- 2) Row Level Security: ครูแต่ละคนเห็น/แก้ได้เฉพาะชุดคำถามของตัวเอง
alter table public.question_sets enable row level security;

drop policy if exists "question_sets_select_own" on public.question_sets;
drop policy if exists "question_sets_insert_own" on public.question_sets;
drop policy if exists "question_sets_update_own" on public.question_sets;
drop policy if exists "question_sets_delete_own" on public.question_sets;

create policy "question_sets_select_own" on public.question_sets
  for select to authenticated using (auth.uid() = user_id);
create policy "question_sets_insert_own" on public.question_sets
  for insert to authenticated with check (auth.uid() = user_id);
create policy "question_sets_update_own" on public.question_sets
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "question_sets_delete_own" on public.question_sets
  for delete to authenticated using (auth.uid() = user_id);

-- 3) ที่เก็บรูปภาพประกอบคำถาม (bucket สาธารณะสำหรับอ่าน เพื่อให้นักเรียนเห็นรูป)
insert into storage.buckets (id, name, public)
values ('question-images', 'question-images', true)
on conflict (id) do update set public = true;

drop policy if exists "question_images_read"   on storage.objects;
drop policy if exists "question_images_insert" on storage.objects;
drop policy if exists "question_images_update" on storage.objects;
drop policy if exists "question_images_delete" on storage.objects;

create policy "question_images_read" on storage.objects
  for select using (bucket_id = 'question-images');
create policy "question_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "question_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "question_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- ขั้นตอนอื่นที่ต้องทำใน Dashboard (ไม่ใช่ SQL):
--  • Authentication > Providers > Email : เปิดใช้งาน
--      - ถ้าอยากให้สมัครแล้วใช้ได้ทันที: ปิด "Confirm email"
--  • Authentication > Providers > "Allow anonymous sign-ins" : เปิด (สำหรับปุ่มผู้ทดสอบบนคลาวด์)
--  • Authentication > URL Configuration : ใส่ Site URL เป็นที่อยู่เว็บของคุณ
-- ============================================================
