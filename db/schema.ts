import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  expected: text("expected").notNull().default(""),
  contact: text("contact").notNull().default(""),
  projectName: text("project_name").notNull().default(""),
  appVersion: text("app_version").notNull(),
  pageUrl: text("page_url").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  viewport: text("viewport").notNull().default(""),
  screenshotKey: text("screenshot_key"),
  screenshotName: text("screenshot_name"),
  screenshotType: text("screenshot_type"),
}, (table) => [
  index("feedback_created_at_idx").on(table.createdAt),
  index("feedback_category_idx").on(table.category),
]);
