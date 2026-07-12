alter table public.cms_documents
  add column if not exists scheduled_publish_at timestamptz,
  add column if not exists scheduled_unpublish_at timestamptz;

alter table public.cms_documents
  drop constraint if exists cms_documents_schedule_order;

alter table public.cms_documents
  add constraint cms_documents_schedule_order
  check (
    scheduled_publish_at is null
    or scheduled_unpublish_at is null
    or scheduled_unpublish_at > scheduled_publish_at
  );

create index if not exists idx_cms_documents_scheduled_publish
  on public.cms_documents(scheduled_publish_at)
  where status = 'draft'
    and scheduled_publish_at is not null;

create index if not exists idx_cms_documents_scheduled_unpublish
  on public.cms_documents(scheduled_unpublish_at)
  where status = 'published'
    and scheduled_unpublish_at is not null;
