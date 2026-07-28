create extension if not exists pgcrypto;

create table if not exists public.cms_settings (
  project_id uuid primary key
    references public.projects(id) on delete cascade,

  email text not null,
  enabled boolean not null default true,

  public_slug text not null unique,
  content_version bigint not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_documents (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects(id) on delete cascade,

  email text not null,

  collection text not null default 'pages'
    check (
      collection in (
        'pages',
        'products',
        'blog',
        'services',
        'testimonials',
        'faqs',
        'navigation',
        'settings'
      )
    ),

  slug text not null,
  title text not null default '',

  status text not null default 'draft'
    check (
      status in (
        'draft',
        'published',
        'archived'
      )
    ),

  content jsonb not null default '{}'::jsonb,
  seo jsonb not null default '{}'::jsonb,

  sort_order integer not null default 0,

  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, collection, slug)
);

create table if not exists public.cms_revisions (
  id uuid primary key default gen_random_uuid(),

  document_id uuid not null
    references public.cms_documents(id) on delete cascade,

  project_id uuid not null
    references public.projects(id) on delete cascade,

  email text not null,
  version_number integer not null,

  snapshot jsonb not null,
  change_note text,

  created_at timestamptz not null default now(),

  unique (document_id, version_number)
);

create table if not exists public.cms_media (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects(id) on delete cascade,

  email text not null,

  file_name text not null,
  storage_path text not null,
  public_url text,

  mime_type text not null,
  size_bytes bigint not null default 0,

  alt_text text not null default '',
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cms_documents_project
  on public.cms_documents(project_id);

create index if not exists idx_cms_documents_email
  on public.cms_documents(email);

create index if not exists idx_cms_documents_collection
  on public.cms_documents(
    project_id,
    collection,
    status,
    sort_order
  );

create index if not exists idx_cms_revisions_document
  on public.cms_revisions(
    document_id,
    version_number desc
  );

create index if not exists idx_cms_media_project
  on public.cms_media(project_id);

create or replace function public.webforge_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cms_settings_updated_at
  on public.cms_settings;

create trigger cms_settings_updated_at
before update on public.cms_settings
for each row execute function public.webforge_set_updated_at();

drop trigger if exists cms_documents_updated_at
  on public.cms_documents;

create trigger cms_documents_updated_at
before update on public.cms_documents
for each row execute function public.webforge_set_updated_at();

drop trigger if exists cms_media_updated_at
  on public.cms_media;

create trigger cms_media_updated_at
before update on public.cms_media
for each row execute function public.webforge_set_updated_at();

alter table public.cms_settings enable row level security;
alter table public.cms_documents enable row level security;
alter table public.cms_revisions enable row level security;
alter table public.cms_media enable row level security;
