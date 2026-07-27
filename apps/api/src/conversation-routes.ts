import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type ConversationIdentity = {
  accountId: string;
  email: string;
  username: string;
};

export type ConversationTurnInput = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  idempotencyKey: string;
  title: string;
  content: string;
  conversationType: "qa" | "generation" | "mixed";
  linkedProjectId?: string | null;
  linkedGenerationId?: string | null;
};

export type ExistingConversationTurn = {
  existing: boolean;
  assistantMessageId: string;
  status: "pending" | "completed" | "failed" | "cancelled";
  content?: string | null;
  provider?: string | null;
  model?: string | null;
  finishReason?: string | null;
  errorCategory?: string | null;
  durationMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

const uuid = z.string().uuid();
const pageLimit = z.coerce.number().int().min(1).max(50).default(30);
const cursor = z.string().min(8).max(500).optional();
const decodedCursorSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  id: uuid,
});

function encodeCursor(timestamp: string, id: string): string {
  return btoa(JSON.stringify({ timestamp, id }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeCursor(value: string | undefined): {
  timestamp: string;
  id: string;
} | null {
  if (!value) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const result = decodedCursorSchema.safeParse(JSON.parse(atob(padded)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const conversationCreateSchema = z
  .object({
    id: uuid,
    title: z.string().trim().min(1).max(120).default("New chat"),
    type: z.enum(["qa", "generation", "mixed"]).default("qa"),
    linkedProjectId: uuid.nullish(),
    linkedGenerationId: uuid.nullish(),
  })
  .strict();

const renameSchema = z
  .object({ title: z.string().trim().min(1).max(120) })
  .strict();

function safeDatabaseError(operation: string, error: unknown): void {
  const value =
    error && typeof error === "object"
      ? (error as { code?: unknown })
      : null;
  console.error(operation, {
    code: typeof value?.code === "string" ? value.code : "unknown",
  });
}

async function readBoundedJson(
  c: any,
  maxBytes: number
): Promise<unknown> {
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { __bodyTooLarge: true };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function enforceConversationRateLimit(
  supabase: SupabaseClient,
  accountId: string,
  scope: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { data, error } = await supabase.rpc("nexora_check_rate_limit", {
    p_account_id: accountId,
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    safeDatabaseError("Conversation rate-limit check failed.", error);
    throw new Error("Could not verify request limits.");
  }
  const result = data as {
    allowed?: unknown;
    retryAfterSeconds?: unknown;
  } | null;
  return {
    allowed: result?.allowed === true,
    retryAfterSeconds:
      typeof result?.retryAfterSeconds === "number"
        ? Math.max(1, Math.round(result.retryAfterSeconds))
        : windowSeconds,
  };
}

export async function beginConversationTurn(
  supabase: SupabaseClient,
  accountId: string,
  input: ConversationTurnInput
): Promise<ExistingConversationTurn> {
  const { data, error } = await supabase.rpc(
    "nexora_begin_conversation_turn",
    {
      p_account_id: accountId,
      p_conversation_id: input.conversationId,
      p_user_message_id: input.userMessageId,
      p_assistant_message_id: input.assistantMessageId,
      p_idempotency_key: input.idempotencyKey,
      p_title: input.title,
      p_content: input.content,
      p_conversation_type: input.conversationType,
      p_linked_project_id: input.linkedProjectId || null,
      p_linked_generation_id: input.linkedGenerationId || null,
    }
  );
  if (error) {
    safeDatabaseError("Conversation turn creation failed.", error);
    throw new Error("Could not save the conversation.");
  }
  return data as ExistingConversationTurn;
}

export async function completeConversationTurn(
  supabase: SupabaseClient,
  accountId: string,
  assistantMessageId: string,
  result: {
    content: string;
    provider: string;
    model: string | null;
    finishReason: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    durationMs: number;
    firstTokenMs?: number | null;
  }
): Promise<void> {
  const { error } = await supabase.rpc(
    "nexora_complete_conversation_turn",
    {
      p_account_id: accountId,
      p_assistant_message_id: assistantMessageId,
      p_content: result.content,
      p_provider: result.provider,
      p_model: result.model || "",
      p_finish_reason: result.finishReason || "",
      p_input_tokens: result.inputTokens,
      p_output_tokens: result.outputTokens,
      p_total_tokens: result.totalTokens,
      p_duration_ms: result.durationMs,
      p_first_token_ms: result.firstTokenMs ?? null,
    }
  );
  if (error) {
    safeDatabaseError("Conversation completion persistence failed.", error);
    throw new Error("Could not save the assistant response.");
  }
}

export async function failConversationTurn(
  supabase: SupabaseClient,
  accountId: string,
  assistantMessageId: string,
  category: string,
  durationMs: number
): Promise<void> {
  const { error } = await supabase.rpc("nexora_fail_conversation_turn", {
    p_account_id: accountId,
    p_assistant_message_id: assistantMessageId,
    p_error_category: category,
    p_duration_ms: Math.max(0, Math.round(durationMs)),
  });
  if (error) {
    safeDatabaseError("Conversation failure persistence failed.", error);
  }
}

export function registerConversationRoutes(
  app: {
    get: (...args: any[]) => unknown;
    post: (...args: any[]) => unknown;
    patch: (...args: any[]) => unknown;
    delete: (...args: any[]) => unknown;
  },
  deps: {
    identity: (c: any) => Promise<ConversationIdentity | null>;
    requireSupabase: (env: any) => SupabaseClient;
  }
): void {
  app.get("/conversations", async (c: any) => {
    const identity = await deps.identity(c);
    if (!identity) return c.json({ error: "Authentication required." }, 401);
    const parsed = z
      .object({ limit: pageLimit, cursor })
      .safeParse({
        limit: c.req.query("limit"),
        cursor: c.req.query("cursor") || undefined,
      });
    if (!parsed.success) {
      return c.json({ error: "Invalid history pagination." }, 400);
    }
    const pageCursor = decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor && !pageCursor) {
      return c.json({ error: "Invalid history cursor." }, 400);
    }

    const supabase = deps.requireSupabase(c.env);
    const readRate = await enforceConversationRateLimit(
      supabase,
      identity.accountId,
      "conversation_read",
      120,
      60
    ).catch(() => null);
    if (!readRate) return c.json({ error: "Could not verify request limits." }, 503);
    if (!readRate.allowed) {
      c.header("Retry-After", String(readRate.retryAfterSeconds));
      return c.json({ error: "Too many history requests. Try again shortly." }, 429);
    }
    let query = supabase
      .from("conversations")
      .select(
        "id,title,conversation_type,linked_project_id,linked_generation_id,created_at,updated_at,last_message_at"
      )
      .eq("account_id", identity.accountId)
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(parsed.data.limit + 1);
    if (pageCursor) {
      query = query.or(
        `last_message_at.lt.${pageCursor.timestamp},and(last_message_at.eq.${pageCursor.timestamp},id.lt.${pageCursor.id})`
      );
    }
    const { data, error } = await query;
    if (error) {
      safeDatabaseError("Conversation list failed.", error);
      return c.json({ error: "Could not load chat history." }, 500);
    }
    const rows = data || [];
    const hasMore = rows.length > parsed.data.limit;
    const conversations = rows.slice(0, parsed.data.limit);
    return c.json({
      conversations,
      nextCursor: hasMore
        ? encodeCursor(
            conversations.at(-1)!.last_message_at,
            conversations.at(-1)!.id
          )
        : null,
    });
  });

  app.post("/conversations", async (c: any) => {
    const identity = await deps.identity(c);
    if (!identity) return c.json({ error: "Authentication required." }, 401);
    const rawBody = await readBoundedJson(c, 16_384);
    if (
      rawBody &&
      typeof rawBody === "object" &&
      "__bodyTooLarge" in rawBody
    ) {
      return c.json({ error: "Request body is too large." }, 413);
    }
    const parsed = conversationCreateSchema.safeParse(
      rawBody
    );
    if (!parsed.success) {
      return c.json({ error: "Invalid conversation." }, 400);
    }
    const supabase = deps.requireSupabase(c.env);
    const rate = await enforceConversationRateLimit(
      supabase,
      identity.accountId,
      "conversation_create",
      20,
      60
    ).catch(() => null);
    if (!rate) return c.json({ error: "Could not verify request limits." }, 503);
    if (!rate.allowed) {
      c.header("Retry-After", String(rate.retryAfterSeconds));
      return c.json({ error: "Too many new conversations. Try again shortly." }, 429);
    }

    if (parsed.data.linkedProjectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("id", parsed.data.linkedProjectId)
        .eq("email", identity.email)
        .maybeSingle();
      if (!project) return c.json({ error: "Linked project not found." }, 404);
    }
    if (parsed.data.linkedGenerationId) {
      const { data: generation } = await supabase
        .from("generation_jobs")
        .select("id")
        .eq("id", parsed.data.linkedGenerationId)
        .eq("email", identity.email)
        .maybeSingle();
      if (!generation) {
        return c.json({ error: "Linked generation not found." }, 404);
      }
    }

    const { data, error } = await supabase
      .from("conversations")
      .upsert(
        {
          id: parsed.data.id,
          account_id: identity.accountId,
          title: parsed.data.title,
          conversation_type: parsed.data.type,
          linked_project_id: parsed.data.linkedProjectId || null,
          linked_generation_id: parsed.data.linkedGenerationId || null,
        },
        { onConflict: "id", ignoreDuplicates: true }
      )
      .select(
        "id,title,conversation_type,linked_project_id,linked_generation_id,created_at,updated_at,last_message_at"
      )
      .maybeSingle();
    if (error) {
      safeDatabaseError("Conversation creation failed.", error);
      return c.json({ error: "Could not create the conversation." }, 500);
    }
    if (!data) {
      const { data: existing } = await supabase
        .from("conversations")
        .select(
          "id,title,conversation_type,linked_project_id,linked_generation_id,created_at,updated_at,last_message_at"
        )
        .eq("id", parsed.data.id)
        .eq("account_id", identity.accountId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!existing) return c.json({ error: "Conversation not found." }, 404);
      return c.json({ conversation: existing, existing: true });
    }
    return c.json({ conversation: data, existing: false }, 201);
  });

  app.get("/conversations/:id/messages", async (c: any) => {
    const identity = await deps.identity(c);
    if (!identity) return c.json({ error: "Authentication required." }, 401);
    const parsed = z
      .object({ id: uuid, limit: pageLimit, cursor })
      .safeParse({
        id: c.req.param("id"),
        limit: c.req.query("limit"),
        cursor: c.req.query("cursor") || undefined,
      });
    if (!parsed.success) return c.json({ error: "Invalid request." }, 400);
    const pageCursor = decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor && !pageCursor) {
      return c.json({ error: "Invalid message cursor." }, 400);
    }
    const supabase = deps.requireSupabase(c.env);
    const readRate = await enforceConversationRateLimit(
      supabase,
      identity.accountId,
      "conversation_read",
      120,
      60
    ).catch(() => null);
    if (!readRate) return c.json({ error: "Could not verify request limits." }, 503);
    if (!readRate.allowed) {
      c.header("Retry-After", String(readRate.retryAfterSeconds));
      return c.json({ error: "Too many history requests. Try again shortly." }, 429);
    }
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", parsed.data.id)
      .eq("account_id", identity.accountId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!conversation) return c.json({ error: "Conversation not found." }, 404);

    let query = supabase
      .from("conversation_messages")
      .select(
        "id,conversation_id,role,content,status,provider,model,finish_reason,error_category,input_tokens,output_tokens,total_tokens,started_at,first_token_at,completed_at,duration_ms,created_at,updated_at"
      )
      .eq("conversation_id", parsed.data.id)
      .eq("account_id", identity.accountId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(parsed.data.limit + 1);
    if (pageCursor) {
      query = query.or(
        `created_at.lt.${pageCursor.timestamp},and(created_at.eq.${pageCursor.timestamp},id.lt.${pageCursor.id})`
      );
    }
    const { data, error } = await query;
    if (error) {
      safeDatabaseError("Conversation messages failed.", error);
      return c.json({ error: "Could not load messages." }, 500);
    }
    const rows = data || [];
    const hasMore = rows.length > parsed.data.limit;
    const page = rows.slice(0, parsed.data.limit);
    const oldest = page.at(-1);
    return c.json({
      messages: page.reverse(),
      nextCursor: hasMore && oldest
        ? encodeCursor(oldest.created_at, oldest.id)
        : null,
    });
  });

  app.post("/conversations/:id/messages/sync", async (c: any) => {
    const identity = await deps.identity(c);
    if (!identity) return c.json({ error: "Authentication required." }, 401);
    const rawBody = await readBoundedJson(c, 128_000);
    if (
      rawBody &&
      typeof rawBody === "object" &&
      "__bodyTooLarge" in rawBody
    ) {
      return c.json({ error: "Request body is too large." }, 413);
    }
    const parsed = z
      .object({
        conversationId: uuid,
        title: z.string().trim().min(1).max(120),
        generationId: uuid,
        messages: z
          .array(
            z
              .object({
                id: uuid,
                role: z.enum(["user", "assistant"]),
                content: z.string().min(1).max(30000),
                status: z.enum(["completed", "failed", "cancelled"]),
                createdAt: z.string().datetime({ offset: true }),
              })
              .strict()
          )
          .min(1)
          .max(4),
      })
      .strict()
      .safeParse({
        ...(rawBody && typeof rawBody === "object" ? rawBody : {}),
        conversationId: c.req.param("id"),
      });
    if (!parsed.success) {
      return c.json({ error: "Invalid generation conversation." }, 400);
    }
    const supabase = deps.requireSupabase(c.env);
    const syncRate = await enforceConversationRateLimit(
      supabase,
      identity.accountId,
      "generation_history_sync",
      30,
      60
    ).catch(() => null);
    if (!syncRate) return c.json({ error: "Could not verify request limits." }, 503);
    if (!syncRate.allowed) {
      c.header("Retry-After", String(syncRate.retryAfterSeconds));
      return c.json({ error: "Too many sync requests. Try again shortly." }, 429);
    }
    const { data: job, error: jobError } = await supabase
      .from("generation_jobs")
      .select("id,status,started_at,completed_at,duration_ms")
      .eq("id", parsed.data.generationId)
      .eq("email", identity.email)
      .maybeSingle();
    if (jobError || !job) {
      return c.json({ error: "Generation job not found." }, 404);
    }
    const terminalStatus = String(job.status || "").toLowerCase();
    if (!["completed", "failed", "cancelled", "canceled"].includes(terminalStatus)) {
      return c.json({ error: "Generation is not finished yet." }, 409);
    }

    const { data: existing } = await supabase
      .from("conversations")
      .select("id,account_id,deleted_at")
      .eq("id", parsed.data.conversationId)
      .maybeSingle();
    if (existing && (
      existing.account_id !== identity.accountId ||
      existing.deleted_at
    )) {
      return c.json({ error: "Conversation not found." }, 404);
    }
    if (!existing) {
      const { error } = await supabase.from("conversations").insert({
        id: parsed.data.conversationId,
        account_id: identity.accountId,
        title: parsed.data.title,
        conversation_type: "generation",
        linked_generation_id: parsed.data.generationId,
      });
      if (error) {
        safeDatabaseError("Generation conversation creation failed.", error);
        return c.json({ error: "Could not save generation history." }, 500);
      }
    }

    const durationMs =
      typeof job.duration_ms === "number" ? job.duration_ms : null;
    const rows = parsed.data.messages.map((message) => ({
      id: message.id,
      conversation_id: parsed.data.conversationId,
      account_id: identity.accountId,
      idempotency_key: `generation-sync:${message.id}`,
      role: message.role,
      content: message.content,
      status:
        message.role === "user"
          ? "completed"
          : terminalStatus === "completed"
            ? "completed"
            : terminalStatus === "failed"
              ? "failed"
              : "cancelled",
      started_at:
        message.role === "assistant" ? job.started_at : message.createdAt,
      completed_at:
        message.role === "assistant" ? job.completed_at : message.createdAt,
      duration_ms: message.role === "assistant" ? durationMs : null,
      created_at: message.createdAt,
      updated_at: new Date().toISOString(),
    }));
    const { error: messageError } = await supabase
      .from("conversation_messages")
      .upsert(rows, {
        onConflict: "account_id,idempotency_key",
        ignoreDuplicates: true,
      });
    if (messageError) {
      safeDatabaseError("Generation messages sync failed.", messageError);
      return c.json({ error: "Could not save generation messages." }, 500);
    }
    const now = new Date().toISOString();
    await supabase
      .from("conversations")
      .update({
        title: parsed.data.title,
        linked_generation_id: parsed.data.generationId,
        updated_at: now,
        last_message_at: now,
      })
      .eq("id", parsed.data.conversationId)
      .eq("account_id", identity.accountId);
    return c.json({ synced: true });
  });

  app.patch("/conversations/:id", async (c: any) => {
    const identity = await deps.identity(c);
    if (!identity) return c.json({ error: "Authentication required." }, 401);
    const id = uuid.safeParse(c.req.param("id"));
    const rawBody = await readBoundedJson(c, 16_384);
    if (
      rawBody &&
      typeof rawBody === "object" &&
      "__bodyTooLarge" in rawBody
    ) {
      return c.json({ error: "Request body is too large." }, 413);
    }
    const body = renameSchema.safeParse(rawBody);
    if (!id.success || !body.success) {
      return c.json({ error: "A valid title is required." }, 400);
    }
    const { data, error } = await deps
      .requireSupabase(c.env)
      .from("conversations")
      .update({
        title: body.data.title,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id.data)
      .eq("account_id", identity.accountId)
      .is("deleted_at", null)
      .select("id,title,updated_at")
      .maybeSingle();
    if (error) {
      safeDatabaseError("Conversation rename failed.", error);
      return c.json({ error: "Could not rename the conversation." }, 500);
    }
    if (!data) return c.json({ error: "Conversation not found." }, 404);
    return c.json({ conversation: data });
  });

  app.delete("/conversations/:id", async (c: any) => {
    const identity = await deps.identity(c);
    if (!identity) return c.json({ error: "Authentication required." }, 401);
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Invalid conversation." }, 400);
    const now = new Date().toISOString();
    const { data, error } = await deps
      .requireSupabase(c.env)
      .from("conversations")
      .update({ deleted_at: now, updated_at: now })
      .eq("id", id.data)
      .eq("account_id", identity.accountId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      safeDatabaseError("Conversation deletion failed.", error);
      return c.json({ error: "Could not delete the conversation." }, 500);
    }
    if (!data) return c.json({ error: "Conversation not found." }, 404);
    return c.json({ deleted: true });
  });
}
