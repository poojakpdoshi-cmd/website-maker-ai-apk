import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

type CmsMediaHelpers = {
  requireUser: (
    context: any,
    email: string,
    installationId?: string
  ) => Promise<any>;

  requireSupabase: (
    env: any
  ) => SupabaseClient;
};

async function authenticateMediaProject(
  context: any,
  helpers: CmsMediaHelpers,
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
        error: 'Your login session is missing or expired.'
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
      .select('id,email,name')
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

export function registerCmsMediaRoutes(
  app: any,
  helpers: CmsMediaHelpers
): void {
  app.get(
    '/cms/projects/:projectId/media',
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
            'Valid Media Library access details are required.'
        }, 400);
      }

      const email =
        parsed.data.email.toLowerCase();

      const auth =
        await authenticateMediaProject(
          context,
          helpers,
          parsed.data.projectId,
          email,
          parsed.data.installationId
        );

      if ('error' in auth) {
        return auth.error;
      }

      const { data, error } =
        await auth.supabase
          .from('cms_media')
          .select(
            'id,file_name,storage_path,public_url,mime_type,size_bytes,alt_text,metadata,created_at,updated_at'
          )
          .eq(
            'project_id',
            parsed.data.projectId
          )
          .eq('email', email)
          .order('created_at', {
            ascending: false
          });

      if (error) {
        return context.json({
          error:
            'Could not load the CMS Media Library.'
        }, 500);
      }

      return context.json({
        media: data || []
      });
    }
  );

  app.post(
    '/cms/projects/:projectId/media',
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
            'Valid Media Library upload details are required.'
        }, 400);
      }

      const email =
        parsed.data.email.toLowerCase();

      const auth =
        await authenticateMediaProject(
          context,
          helpers,
          parsed.data.projectId,
          email,
          parsed.data.installationId
        );

      if ('error' in auth) {
        return auth.error;
      }

      const body = await context.req
        .parseBody()
        .catch(() => null);

      const file = body?.file;
      const altText =
        typeof body?.altText === 'string'
          ? body.altText.trim().slice(0, 300)
          : '';

      if (!(file instanceof File)) {
        return context.json({
          error: 'Choose a valid image file.'
        }, 400);
      }

      const allowedTypes: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif'
      };

      const extension =
        allowedTypes[file.type];

      if (!extension) {
        return context.json({
          error:
            'Only JPG, PNG, WebP and GIF images are supported.'
        }, 415);
      }

      if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
        return context.json({
          error:
            'Image must be smaller than 5 MB.'
        }, 413);
      }

      const storagePath =
        `${parsed.data.projectId}/` +
        `${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } =
        await auth.supabase.storage
          .from('cms-media')
          .upload(storagePath, file, {
            contentType: file.type,
            cacheControl: '3600',
            upsert: false
          });

      if (uploadError) {
        return context.json({
          error:
            'Could not upload the image.'
        }, 500);
      }

      const { data: publicData } =
        auth.supabase.storage
          .from('cms-media')
          .getPublicUrl(storagePath);

      const publicUrl =
        publicData.publicUrl;

      const { data: media, error: insertError } =
        await auth.supabase
          .from('cms_media')
          .insert({
            project_id:
              parsed.data.projectId,
            email,
            file_name:
              file.name.slice(0, 180),
            storage_path:
              storagePath,
            public_url:
              publicUrl,
            mime_type:
              file.type,
            size_bytes:
              file.size,
            alt_text:
              altText,
            metadata: {
              originalName: file.name,
              uploadedFrom: 'webforge-cms'
            }
          })
          .select('*')
          .single();

      if (insertError || !media) {
        await auth.supabase.storage
          .from('cms-media')
          .remove([storagePath]);

        return context.json({
          error:
            'Image uploaded, but its CMS record could not be saved.'
        }, 500);
      }

      return context.json({
        media
      }, 201);
    }
  );

  app.patch(
    '/cms/media/:mediaId',
    async (context: any) => {
      const metadata = z.object({
        mediaId: z.string().uuid(),
        projectId: z.string().uuid(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        mediaId:
          context.req.param('mediaId'),
        projectId:
          context.req.query('projectId'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      const body = z.object({
        altText: z.string()
          .trim()
          .max(300)
      }).safeParse(
        await context.req
          .json()
          .catch(() => null)
      );

      if (!metadata.success || !body.success) {
        return context.json({
          error:
            'Valid image and alt-text details are required.'
        }, 400);
      }

      const email =
        metadata.data.email.toLowerCase();

      const auth =
        await authenticateMediaProject(
          context,
          helpers,
          metadata.data.projectId,
          email,
          metadata.data.installationId
        );

      if ('error' in auth) {
        return auth.error;
      }

      const { data: media, error } =
        await auth.supabase
          .from('cms_media')
          .update({
            alt_text: body.data.altText
          })
          .eq('id', metadata.data.mediaId)
          .eq(
            'project_id',
            metadata.data.projectId
          )
          .eq('email', email)
          .select('*')
          .maybeSingle();

      if (error || !media) {
        return context.json({
          error:
            'Could not update this image.'
        }, 404);
      }

      return context.json({
        media
      });
    }
  );

  app.delete(
    '/cms/media/:mediaId',
    async (context: any) => {
      const parsed = z.object({
        mediaId: z.string().uuid(),
        projectId: z.string().uuid(),
        email: z.string().email(),
        installationId: z.string().uuid()
      }).safeParse({
        mediaId:
          context.req.param('mediaId'),
        projectId:
          context.req.query('projectId'),
        email:
          context.req.query('email'),
        installationId:
          context.req.header('X-Device-Id')
      });

      if (!parsed.success) {
        return context.json({
          error:
            'Valid image deletion details are required.'
        }, 400);
      }

      const email =
        parsed.data.email.toLowerCase();

      const auth =
        await authenticateMediaProject(
          context,
          helpers,
          parsed.data.projectId,
          email,
          parsed.data.installationId
        );

      if ('error' in auth) {
        return auth.error;
      }

      const { data: media, error: lookupError } =
        await auth.supabase
          .from('cms_media')
          .select('id,storage_path')
          .eq('id', parsed.data.mediaId)
          .eq(
            'project_id',
            parsed.data.projectId
          )
          .eq('email', email)
          .maybeSingle();

      if (lookupError || !media) {
        return context.json({
          error:
            'CMS image was not found.'
        }, 404);
      }

      const { error: storageError } =
        await auth.supabase.storage
          .from('cms-media')
          .remove([media.storage_path]);

      if (storageError) {
        return context.json({
          error:
            'Could not remove the image file.'
        }, 500);
      }

      const { error: deleteError } =
        await auth.supabase
          .from('cms_media')
          .delete()
          .eq('id', parsed.data.mediaId)
          .eq(
            'project_id',
            parsed.data.projectId
          )
          .eq('email', email);

      if (deleteError) {
        return context.json({
          error:
            'Image file removed, but its CMS record could not be deleted.'
        }, 500);
      }

      return context.json({
        deleted: true
      });
    }
  );
}
