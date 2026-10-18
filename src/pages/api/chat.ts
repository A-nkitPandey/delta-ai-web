/**
 * POST /api/chat — "Ask Delta", the website's AI assistant.
 *
 * Answers questions about Delta AI using only the site's own content
 * (services, industries, plans, FAQ, careers). Nothing is stored.
 *
 * Runs on Workers AI (free daily allowance). Protected by a same-origin check,
 * a size limit, strict input validation and a per-visitor rate limit.
 */
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { z } from "astro/zod";
import { site } from "@/lib/site";
import { askDelta } from "@/lib/assistant";

export const prerender = false;

const MAX_BODY_BYTES = 8 * 1024;

const ChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(600),
      }),
    )
    .min(1)
    .max(10),
});

function json(
  status: number,
  body: Record<string, unknown>,
  extra: HeadersInit = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  if (!origin || origin !== url.origin)
    return json(403, { message: "Forbidden." });
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json"))
    return json(415, { message: "Unsupported content type." });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES)
    return json(413, {
      message: "That message is a bit long — please shorten it.",
    });

  let messages: z.infer<typeof ChatSchema>["messages"];
  try {
    const parsed = ChatSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return json(400, {
        message: "Please type a shorter question (up to 600 characters).",
      });
    messages = parsed.data.messages;
  } catch {
    return json(400, { message: "Invalid request." });
  }
  if (messages[messages.length - 1].role !== "user")
    return json(400, { message: "Invalid request." });

  const ip =
    request.headers.get("CF-Connecting-IP") ?? clientAddress ?? "unknown";
  const limiter = (env as { CHAT_LIMITER?: RateLimit }).CHAT_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: `chat:${ip}` });
    if (!success)
      return json(
        429,
        {
          message:
            "You’re typing faster than I can think! Please wait a minute and try again.",
        },
        { "Retry-After": "60" },
      );
  }

  if (!(env as { AI?: Ai }).AI)
    return json(503, {
      message: `The assistant is offline right now. Please email us at ${site.contact.email}.`,
    });

  const reply = await askDelta(messages, "web");
  if (reply) return json(200, { reply });
  return json(503, {
    message: `I can’t answer right now — the assistant has reached its limit for today. Please use the contact form or email ${site.contact.email} and the team will reply within one business day.`,
  });
};

export const ALL: APIRoute = () =>
  json(405, { message: "Method not allowed." }, { Allow: "POST" });
