import { env } from "cloudflare:workers";

type FeedbackBindings = {
  DB: D1Database;
  FEEDBACK_FILES: R2Bucket;
  FEEDBACK_ADMIN_KEY?: string;
};

const bindings = env as unknown as FeedbackBindings;
const MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024;
const categories = new Set(["功能建议", "操作困难", "显示问题", "程序错误", "其他"]);

async function ensureFeedbackSchema() {
  await bindings.DB.batch([
    bindings.DB.prepare(`
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        expected TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        project_name TEXT NOT NULL DEFAULT '',
        app_version TEXT NOT NULL,
        page_url TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        viewport TEXT NOT NULL DEFAULT '',
        screenshot_key TEXT,
        screenshot_name TEXT,
        screenshot_type TEXT
      )
    `),
    bindings.DB.prepare("CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback(created_at)"),
    bindings.DB.prepare("CREATE INDEX IF NOT EXISTS feedback_category_idx ON feedback(category)"),
  ]);
}

function stringField(form: FormData, key: string, maxLength: number) {
  return String(form.get(key) || "").trim().slice(0, maxLength);
}

function isAdmin(request: Request) {
  const configured = bindings.FEEDBACK_ADMIN_KEY;
  return Boolean(configured && request.headers.get("x-feedback-admin-key") === configured);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const category = stringField(form, "category", 30);
    const description = stringField(form, "description", 3000);
    const expected = stringField(form, "expected", 2000);
    const contact = stringField(form, "contact", 200);
    const projectName = stringField(form, "projectName", 200);
    const appVersion = stringField(form, "appVersion", 40) || "unknown";
    const pageUrl = stringField(form, "pageUrl", 500);
    const userAgent = stringField(form, "userAgent", 500);
    const viewport = stringField(form, "viewport", 50);

    if (!categories.has(category)) {
      return Response.json({ error: "请选择有效的反馈类型" }, { status: 400 });
    }
    if (description.length < 5) {
      return Response.json({ error: "请至少填写 5 个字的问题描述" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const screenshot = form.get("screenshot");
    let screenshotKey: string | null = null;
    let screenshotName: string | null = null;
    let screenshotType: string | null = null;

    if (screenshot instanceof File && screenshot.size > 0) {
      if (!screenshot.type.startsWith("image/")) {
        return Response.json({ error: "截图必须是图片文件" }, { status: 400 });
      }
      if (screenshot.size > MAX_SCREENSHOT_SIZE) {
        return Response.json({ error: "截图不能超过 5MB" }, { status: 400 });
      }
      screenshotName = screenshot.name.slice(0, 200);
      screenshotType = screenshot.type;
      screenshotKey = `feedback/${id}/${screenshotName}`;
      await bindings.FEEDBACK_FILES.put(screenshotKey, screenshot.stream(), {
        httpMetadata: { contentType: screenshotType },
      });
    }

    await ensureFeedbackSchema();
    await bindings.DB.prepare(`
      INSERT INTO feedback (
        id, created_at, category, description, expected, contact, project_name,
        app_version, page_url, user_agent, viewport,
        screenshot_key, screenshot_name, screenshot_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      new Date().toISOString(),
      category,
      description,
      expected,
      contact,
      projectName,
      appVersion,
      pageUrl,
      userAgent,
      viewport,
      screenshotKey,
      screenshotName,
      screenshotType,
    ).run();

    return Response.json({ id, message: "感谢反馈，我们已经收到。" }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!isAdmin(request)) {
    return Response.json({ error: "管理员口令不正确" }, { status: 401 });
  }

  try {
    await ensureFeedbackSchema();
    const result = await bindings.DB.prepare(`
      SELECT
        id,
        created_at AS createdAt,
        category,
        description,
        expected,
        contact,
        project_name AS projectName,
        app_version AS appVersion,
        page_url AS pageUrl,
        user_agent AS userAgent,
        viewport,
        screenshot_name AS screenshotName
      FROM feedback
      ORDER BY created_at DESC
      LIMIT 200
    `).all();
    return Response.json({ feedback: result.results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
