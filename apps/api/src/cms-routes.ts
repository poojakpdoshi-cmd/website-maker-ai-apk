import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

type CmsHelpers = {
  requireUser: (
    context: any,
    email: string,
    installationId?: string
  ) => Promise<any>;

  requireSupabase: (
    env: any
  ) => SupabaseClient;
};

const collectionSchema = z.enum([
  'pages',
  'products',
  'blog',
  'services',
  'testimonials',
  'faqs',
  'navigation',
  'settings'
]);

const statusSchema = z.enum([
  'draft',
  'published',
  'archived'
]);

const documentSchema = z.object({
  collection: collectionSchema.default('pages'),

  slug: z.string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),

  title: z.string()
    .trim()
    .min(1)
    .max(180),

  status: statusSchema.default('draft'),

  content: z.record(
    z.string(),
    z.unknown()
  ).default({}),

  seo: z.record(
    z.string(),
    z.unknown()
  ).default({}),

  sortOrder: z.number()
    .int()
    .min(-10000)
    .max(10000)
    .default(0)
});

const updateDocumentSchema =
  documentSchema.partial();

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 55) || 'website';
}

function documentSnapshot(
  document: Record<string, unknown>
) {
  return {
    collection: document.collection,
    slug: document.slug,
    title: document.title,
    status: document.status,
    content: document.content || {},
    seo: document.seo || {},
    sort_order: document.sort_order || 0,
    published_at: document.published_at || null
  };
}

async function saveRevision(
  supabase: SupabaseClient,
  document: Record<string, unknown>,
  email: string,
  note: string
) {
  const documentId = String(document.id);

  const { data: latest } = await supabase
    .from('cms_revisions')
    .select('version_number')
    .eq('document_id', documentId)
    .order('version_number', {
      ascending: false
    })
    .limit(1)
    .maybeSingle();

  const versionNumber =
    Number(latest?.version_number || 0) + 1;

  const { error } = await supabase
    .from('cms_revisions')
    .insert({
      document_id: documentId,
      project_id: String(document.project_id),
      email,
      version_number: versionNumber,
      snapshot: documentSnapshot(document),
      change_note: note
    });

  if (error) {
    throw new Error(
      'Could not save CMS revision.'
    );
  }
}

async function increaseContentVersion(
  supabase: SupabaseClient,
  projectId: string
) {
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

async function authenticateProject(
  context: any,
  helpers: CmsHelpers,
  projectId: string,
  email: string,
  installationId: string
) {
  const access = await helpers.requireUser(
    context,
    email,
    installationId
  );

  if (!access) {
    return {
      error: context.json({
        error:
          'Your login session is missing or expired.'
      }, 401)
    };
  }

  if (!access.ok) {
    return {
      error: context.json({
        error: access.error
      }, access.status)
    };
  }

  const supabase =
    helpers.requireSupabase(context.env);

  const { data: project, error } =
    await supabase
      .from('projects')
      .select('id,email,name,plan')
      .eq('id', projectId)
      .eq('email', email)
      .maybeSingle();

  if (error || !project) {
    return {
      error: context.json({
        error: 'Project was not found.'
      }, 404)
    };
  }

  return {
    supabase,
    project
  };
}

async function authenticateDocument(
  context: any,
  helpers: CmsHelpers,
  documentId: string,
  email: string,
  installationId: string
) {
  const access = await helpers.requireUser(
    context,
    email,
    installationId
  );

  if (!access) {
    return {
      error: context.json({
        error:
          'Your login session is missing or expired.'
      }, 401)
    };
  }

  if (!access.ok) {
    return {
      error: context.json({
        error: access.error
      }, access.status)
    };
  }

  const supabase =
    helpers.requireSupabase(context.env);

  const { data: document, error } =
    await supabase
      .from('cms_documents')
      .select('*')
      .eq('id', documentId)
      .eq('email', email)
      .maybeSingle();

  if (error || !document) {
    return {
      error: context.json({
        error: 'CMS document was not found.'
      }, 404)
    };
  }

  return {
    supabase,
    document
  };
}

export function registerCmsRoutes(
  app: any,
  helpers: CmsHelpers
): void {
  app.post(
    '/cms/projects/:projectId/bootstrap',
    async (context: any) => {
      const parsed = z.object({
        projectId: z.string().uuid(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        projectId:
          context.req.param('projectId'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      if (!parsed.success) {
        return context.json({
          error:
            'Valid CMS access details are required.'
        }, 400);
      }

      const email =
        parsed.data.email.toLowerCase();

      const auth = await authenticateProject(
        context,
        helpers,
        parsed.data.projectId,
        email,
        parsed.data.installationId
      );

      if ('error' in auth) {
        return auth.error;
      }

      const projectName = String(
        auth.project.name || 'website'
      );

      const publicSlug =
        `${slugify(projectName)}-${
          parsed.data.projectId.slice(0, 8)
        }`;

      const { data: settings, error } =
        await auth.supabase
          .from('cms_settings')
          .upsert({
            project_id:
              parsed.data.projectId,
            email,
            enabled: true,
            public_slug: publicSlug
          }, {
            onConflict: 'project_id'
          })
          .select('*')
          .single();

      if (error || !settings) {
        return context.json({
          error: 'Could not enable the CMS.'
        }, 500);
      }

      const { count } = await auth.supabase
        .from('cms_documents')
        .select('id', {
          count: 'exact',
          head: true
        })
        .eq(
          'project_id',
          parsed.data.projectId
        );

      if (!count) {
        const plan =
          auth.project.plan &&
          typeof auth.project.plan === 'object'
            ? auth.project.plan as
              Record<string, unknown>
            : {};

        const { error: seedError } =
          await auth.supabase
            .from('cms_documents')
            .insert({
              project_id:
                parsed.data.projectId,
              email,
              collection: 'pages',
              slug: 'home',
              title: 'Home',
              status: 'published',
              content: {
                heading:
                  plan.businessName ||
                  projectName,
                tagline:
                  plan.tagline ||
                  'Welcome to our website.',
                sections:
                  Array.isArray(plan.sections)
                    ? plan.sections
                    : []
              },
              seo: {
                title:
                  plan.businessName ||
                  projectName,
                description:
                  plan.tagline || ''
              },
              sort_order: 0,
              published_at:
                new Date().toISOString()
            });

        if (seedError) {
          return context.json({
            error:
              'CMS enabled, but starter content could not be created.'
          }, 500);
        }
      }

      return context.json({
        enabled: true,
        settings
      });
    }
  );

  app.get(
    '/cms/projects/:projectId',
    async (context: any) => {
      const parsed = z.object({
        projectId: z.string().uuid(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        projectId:
          context.req.param('projectId'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      if (!parsed.success) {
        return context.json({
          error:
            'Valid CMS access details are required.'
        }, 400);
      }

      const email =
        parsed.data.email.toLowerCase();

      const auth = await authenticateProject(
        context,
        helpers,
        parsed.data.projectId,
        email,
        parsed.data.installationId
      );

      if ('error' in auth) {
        return auth.error;
      }

      const [
        settingsResult,
        documentsResult
      ] = await Promise.all([
        auth.supabase
          .from('cms_settings')
          .select('*')
          .eq(
            'project_id',
            parsed.data.projectId
          )
          .maybeSingle(),

        auth.supabase
          .from('cms_documents')
          .select('*')
          .eq(
            'project_id',
            parsed.data.projectId
          )
          .order('collection', {
            ascending: true
          })
          .order('sort_order', {
            ascending: true
          })
          .order('updated_at', {
            ascending: false
          })
      ]);

      if (documentsResult.error) {
        return context.json({
          error:
            'Could not load CMS documents.'
        }, 500);
      }

      return context.json({
        project: {
          id: auth.project.id,
          name: auth.project.name
        },
        settings:
          settingsResult.data || null,
        documents:
          documentsResult.data || []
      });
    }
  );

  app.post(
    '/cms/projects/:projectId/documents',
    async (context: any) => {
      const metadata = z.object({
        projectId: z.string().uuid(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        projectId:
          context.req.param('projectId'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      const body = documentSchema.safeParse(
        await context.req
          .json()
          .catch(() => null)
      );

      if (
        !metadata.success ||
        !body.success
      ) {
        return context.json({
          error:
            'Enter valid CMS document details.'
        }, 400);
      }

      const email =
        metadata.data.email.toLowerCase();

      const auth = await authenticateProject(
        context,
        helpers,
        metadata.data.projectId,
        email,
        metadata.data.installationId
      );

      if ('error' in auth) {
        return auth.error;
      }

      const { data: document, error } =
        await auth.supabase
          .from('cms_documents')
          .insert({
            project_id:
              metadata.data.projectId,
            email,
            collection:
              body.data.collection,
            slug:
              body.data.slug,
            title:
              body.data.title,
            status:
              body.data.status,
            content:
              body.data.content,
            seo:
              body.data.seo,
            sort_order:
              body.data.sortOrder,
            published_at:
              body.data.status === 'published'
                ? new Date().toISOString()
                : null
          })
          .select('*')
          .single();

      if (error || !document) {
        return context.json({
          error:
            error?.code === '23505'
              ? 'A CMS item with this slug already exists.'
              : 'Could not create the CMS document.'
        }, error?.code === '23505' ? 409 : 500);
      }

      await saveRevision(
        auth.supabase,
        document,
        email,
        'Document created'
      );

      await increaseContentVersion(
        auth.supabase,
        metadata.data.projectId
      );

      return context.json({
        document
      }, 201);
    }
  );

  app.patch(
    '/cms/documents/:documentId',
    async (context: any) => {
      const metadata = z.object({
        documentId: z.string().uuid(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        documentId:
          context.req.param('documentId'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      const body =
        updateDocumentSchema.safeParse(
          await context.req
            .json()
            .catch(() => null)
        );

      if (
        !metadata.success ||
        !body.success ||
        Object.keys(body.data).length === 0
      ) {
        return context.json({
          error:
            'Enter valid CMS changes.'
        }, 400);
      }

      const email =
        metadata.data.email.toLowerCase();

      const auth = await authenticateDocument(
        context,
        helpers,
        metadata.data.documentId,
        email,
        metadata.data.installationId
      );

      if ('error' in auth) {
        return auth.error;
      }

      await saveRevision(
        auth.supabase,
        auth.document,
        email,
        'Before document update'
      );

      const changes:
        Record<string, unknown> = {};

      if (
        body.data.collection !== undefined
      ) {
        changes.collection =
          body.data.collection;
      }

      if (body.data.slug !== undefined) {
        changes.slug = body.data.slug;
      }

      if (body.data.title !== undefined) {
        changes.title = body.data.title;
      }

      if (body.data.content !== undefined) {
        changes.content = body.data.content;
      }

      if (body.data.seo !== undefined) {
        changes.seo = body.data.seo;
      }

      if (
        body.data.sortOrder !== undefined
      ) {
        changes.sort_order =
          body.data.sortOrder;
      }

      if (body.data.status !== undefined) {
        changes.status = body.data.status;

        changes.published_at =
          body.data.status === 'published'
            ? new Date().toISOString()
            : null;
      }

      const { data: document, error } =
        await auth.supabase
          .from('cms_documents')
          .update(changes)
          .eq(
            'id',
            metadata.data.documentId
          )
          .eq('email', email)
          .select('*')
          .single();

      if (error || !document) {
        return context.json({
          error:
            error?.code === '23505'
              ? 'A CMS item with this slug already exists.'
              : 'Could not update the CMS document.'
        }, error?.code === '23505' ? 409 : 500);
      }

      await increaseContentVersion(
        auth.supabase,
        String(auth.document.project_id)
      );

      return context.json({
        document
      });
    }
  );

  app.delete(
    '/cms/documents/:documentId',
    async (context: any) => {
      const parsed = z.object({
        documentId: z.string().uuid(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        documentId:
          context.req.param('documentId'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      if (!parsed.success) {
        return context.json({
          error:
            'Valid CMS document details are required.'
        }, 400);
      }

      const email =
        parsed.data.email.toLowerCase();

      const auth = await authenticateDocument(
        context,
        helpers,
        parsed.data.documentId,
        email,
        parsed.data.installationId
      );

      if ('error' in auth) {
        return auth.error;
      }

      const projectId = String(
        auth.document.project_id
      );

      const { error } = await auth.supabase
        .from('cms_documents')
        .delete()
        .eq('id', parsed.data.documentId)
        .eq('email', email);

      if (error) {
        return context.json({
          error:
            'Could not delete the CMS document.'
        }, 500);
      }

      await increaseContentVersion(
        auth.supabase,
        projectId
      );

      return context.json({
        deleted: true
      });
    }
  );

  app.post(
    '/cms/documents/:documentId/publish',
    async (context: any) => {
      const parsed = z.object({
        documentId: z.string().uuid(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        documentId:
          context.req.param('documentId'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      if (!parsed.success) {
        return context.json({
          error:
            'Valid CMS publishing details are required.'
        }, 400);
      }

      const email =
        parsed.data.email.toLowerCase();

      const auth = await authenticateDocument(
        context,
        helpers,
        parsed.data.documentId,
        email,
        parsed.data.installationId
      );

      if ('error' in auth) {
        return auth.error;
      }

      await saveRevision(
        auth.supabase,
        auth.document,
        email,
        'Before publishing'
      );

      const { data: document, error } =
        await auth.supabase
          .from('cms_documents')
          .update({
            status: 'published',
            published_at:
              new Date().toISOString()
          })
          .eq('id', parsed.data.documentId)
          .eq('email', email)
          .select('*')
          .single();

      if (error || !document) {
        return context.json({
          error:
            'Could not publish the CMS document.'
        }, 500);
      }

      await increaseContentVersion(
        auth.supabase,
        String(auth.document.project_id)
      );

      return context.json({
        published: true,
        document
      });
    }
  );

  app.post(
    '/cms/documents/:documentId/draft',
    async (context: any) => {
      const parsed = z.object({
        documentId: z.string().uuid(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        documentId:
          context.req.param('documentId'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      if (!parsed.success) {
        return context.json({
          error:
            'Valid CMS draft details are required.'
        }, 400);
      }

      const email =
        parsed.data.email.toLowerCase();

      const auth = await authenticateDocument(
        context,
        helpers,
        parsed.data.documentId,
        email,
        parsed.data.installationId
      );

      if ('error' in auth) {
        return auth.error;
      }

      await saveRevision(
        auth.supabase,
        auth.document,
        email,
        'Before moving to draft'
      );

      const { data: document, error } =
        await auth.supabase
          .from('cms_documents')
          .update({
            status: 'draft',
            published_at: null
          })
          .eq('id', parsed.data.documentId)
          .eq('email', email)
          .select('*')
          .single();

      if (error || !document) {
        return context.json({
          error:
            'Could not move the CMS document to draft.'
        }, 500);
      }

      await increaseContentVersion(
        auth.supabase,
        String(auth.document.project_id)
      );

      return context.json({
        draft: true,
        document
      });
    }
  );

  app.get(
    '/cms/documents/:documentId/revisions',
    async (context: any) => {
      const parsed = z.object({
        documentId: z.string().uuid(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        documentId:
          context.req.param('documentId'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      if (!parsed.success) {
        return context.json({
          error:
            'Valid CMS revision details are required.'
        }, 400);
      }

      const email =
        parsed.data.email.toLowerCase();

      const auth = await authenticateDocument(
        context,
        helpers,
        parsed.data.documentId,
        email,
        parsed.data.installationId
      );

      if ('error' in auth) {
        return auth.error;
      }

      const { data, error } =
        await auth.supabase
          .from('cms_revisions')
          .select(
            'id,version_number,change_note,created_at,snapshot'
          )
          .eq(
            'document_id',
            parsed.data.documentId
          )
          .eq('email', email)
          .order('version_number', {
            ascending: false
          });

      if (error) {
        return context.json({
          error:
            'Could not load CMS revision history.'
        }, 500);
      }

      return context.json({
        revisions: data || []
      });
    }
  );

  app.post(
    '/cms/documents/:documentId/restore/:version',
    async (context: any) => {
      const parsed = z.object({
        documentId: z.string().uuid(),
        version: z.coerce.number().int().positive(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        documentId:
          context.req.param('documentId'),
        version:
          context.req.param('version'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      if (!parsed.success) {
        return context.json({
          error:
            'Valid CMS restore details are required.'
        }, 400);
      }

      const email =
        parsed.data.email.toLowerCase();

      const auth = await authenticateDocument(
        context,
        helpers,
        parsed.data.documentId,
        email,
        parsed.data.installationId
      );

      if ('error' in auth) {
        return auth.error;
      }

      const { data: revision, error } =
        await auth.supabase
          .from('cms_revisions')
          .select('snapshot')
          .eq(
            'document_id',
            parsed.data.documentId
          )
          .eq(
            'version_number',
            parsed.data.version
          )
          .eq('email', email)
          .maybeSingle();

      if (error || !revision) {
        return context.json({
          error:
            'CMS revision was not found.'
        }, 404);
      }

      await saveRevision(
        auth.supabase,
        auth.document,
        email,
        `Before restoring version ${parsed.data.version}`
      );

      const snapshot =
        revision.snapshot &&
        typeof revision.snapshot === 'object'
          ? revision.snapshot as
            Record<string, unknown>
          : {};

      const { data: document, error: updateError } =
        await auth.supabase
          .from('cms_documents')
          .update({
            collection:
              snapshot.collection,
            slug:
              snapshot.slug,
            title:
              snapshot.title,
            status:
              snapshot.status,
            content:
              snapshot.content || {},
            seo:
              snapshot.seo || {},
            sort_order:
              snapshot.sort_order || 0,
            published_at:
              snapshot.published_at || null
          })
          .eq(
            'id',
            parsed.data.documentId
          )
          .eq('email', email)
          .select('*')
          .single();

      if (updateError || !document) {
        return context.json({
          error:
            'Could not restore the CMS revision.'
        }, 500);
      }

      await increaseContentVersion(
        auth.supabase,
        String(auth.document.project_id)
      );

      return context.json({
        restored: true,
        document
      });
    }
  );

  app.get(
    '/public/cms/:publicSlug',
    async (context: any) => {
      const publicSlug =
        context.req.param('publicSlug');

      if (
        !publicSlug ||
        publicSlug.length > 120
      ) {
        return context.json({
          error:
            'Invalid CMS website slug.'
        }, 400);
      }

      const supabase =
        helpers.requireSupabase(
          context.env
        );

      const { data: settings, error } =
        await supabase
          .from('cms_settings')
          .select(
            'project_id,public_slug,content_version,updated_at'
          )
          .eq(
            'public_slug',
            publicSlug
          )
          .eq('enabled', true)
          .maybeSingle();

      if (error || !settings) {
        return context.json({
          error:
            'Published CMS website was not found.'
        }, 404);
      }

      const {
        data: documents,
        error: documentsError
      } = await supabase
        .from('cms_documents')
        .select(
          'id,collection,slug,title,content,seo,sort_order,published_at,updated_at'
        )
        .eq(
          'project_id',
          settings.project_id
        )
        .eq('status', 'published')
        .order('collection', {
          ascending: true
        })
        .order('sort_order', {
          ascending: true
        });

      if (documentsError) {
        return context.json({
          error:
            'Could not load published CMS content.'
        }, 500);
      }

      return context.json({
        publicSlug:
          settings.public_slug,
        contentVersion:
          settings.content_version,
        updatedAt:
          settings.updated_at,
        documents:
          documents || []
      }, 200, {
        'Cache-Control':
          'public, max-age=60, stale-while-revalidate=300'
      });
    }
  );
}
