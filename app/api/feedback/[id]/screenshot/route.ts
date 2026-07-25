import { env } from "cloudflare:workers";

type FeedbackBindings = {
  DB: D1Database;
  FEEDBACK_FILES: R2Bucket;
  FEEDBACK_ADMIN_KEY?: string;
};

const bindings = env as unknown as FeedbackBindings;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!bindings.FEEDBACK_ADMIN_KEY || request.headers.get("x-feedback-admin-key") !== bindings.FEEDBACK_ADMIN_KEY) {
    return Response.json({ error: "管理员口令不正确" }, { status: 401 });
  }

  const { id } = await context.params;
  const row = await bindings.DB.prepare(
    "SELECT screenshot_key AS screenshotKey, screenshot_name AS screenshotName, screenshot_type AS screenshotType FROM feedback WHERE id = ?",
  ).bind(id).first<{ screenshotKey: string | null; screenshotName: string | null; screenshotType: string | null }>();

  if (!row?.screenshotKey) {
    return Response.json({ error: "没有截图" }, { status: 404 });
  }

  const object = await bindings.FEEDBACK_FILES.get(row.screenshotKey);
  if (!object) {
    return Response.json({ error: "截图不存在" }, { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "content-type": row.screenshotType || object.httpMetadata?.contentType || "application/octet-stream",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.screenshotName || "feedback.png")}`,
      "cache-control": "private, no-store",
    },
  });
}
