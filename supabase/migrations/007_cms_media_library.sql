insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'cms-media',
  'cms-media',
  true,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create unique index if not exists
  idx_cms_media_storage_path
on public.cms_media(storage_path);

create index if not exists
  idx_cms_media_project_created
on public.cms_media(
  project_id,
  created_at desc
);
