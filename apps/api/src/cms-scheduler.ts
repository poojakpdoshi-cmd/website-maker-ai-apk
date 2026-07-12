import type { SupabaseClient } from '@supabase/supabase-js';

type CmsScheduledDocument = {
  id: string;
  project_id: string;
};

async function bumpContentVersions(
  supabase: SupabaseClient,
  projectIds: Set<string>
): Promise<void> {
  for (const projectId of projectIds) {
    const { data } = await supabase
      .from('cms_settings')
      .select('content_version')
      .eq('project_id', projectId)
      .maybeSingle();

    await supabase
      .from('cms_settings')
      .update({
        content_version:
          Number(data?.content_version || 0) + 1
      })
      .eq('project_id', projectId);
  }
}

export async function processCmsSchedules(
  supabase: SupabaseClient
): Promise<{
  published: number;
  unpublished: number;
}> {
  const now = new Date().toISOString();
  const changedProjects = new Set<string>();

  const { data: publishItems, error: publishLoadError } =
    await supabase
      .from('cms_documents')
      .select('id,project_id')
      .eq('status', 'draft')
      .not('scheduled_publish_at', 'is', null)
      .lte('scheduled_publish_at', now);

  if (publishLoadError) {
    throw new Error(
      'Could not load scheduled publishing items.'
    );
  }

  let published = 0;

  for (
    const item of
    (publishItems || []) as CmsScheduledDocument[]
  ) {
    const { data } = await supabase
      .from('cms_documents')
      .update({
        status: 'published',
        published_at: now,
        scheduled_publish_at: null
      })
      .eq('id', item.id)
      .eq('status', 'draft')
      .lte('scheduled_publish_at', now)
      .select('id')
      .maybeSingle();

    if (data) {
      published += 1;
      changedProjects.add(item.project_id);
    }
  }

  const {
    data: unpublishItems,
    error: unpublishLoadError
  } = await supabase
    .from('cms_documents')
    .select('id,project_id')
    .eq('status', 'published')
    .not('scheduled_unpublish_at', 'is', null)
    .lte('scheduled_unpublish_at', now);

  if (unpublishLoadError) {
    throw new Error(
      'Could not load scheduled unpublishing items.'
    );
  }

  let unpublished = 0;

  for (
    const item of
    (unpublishItems || []) as CmsScheduledDocument[]
  ) {
    const { data } = await supabase
      .from('cms_documents')
      .update({
        status: 'draft',
        published_at: null,
        scheduled_unpublish_at: null
      })
      .eq('id', item.id)
      .eq('status', 'published')
      .lte('scheduled_unpublish_at', now)
      .select('id')
      .maybeSingle();

    if (data) {
      unpublished += 1;
      changedProjects.add(item.project_id);
    }
  }

  await bumpContentVersions(
    supabase,
    changedProjects
  );

  return {
    published,
    unpublished
  };
}
