import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders PlanThrough routes and product metadata", async () => {
  for (const pathname of ["/", "/projects"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /<title>PlanThrough · 一张图，无限穿透<\/title>/i);
    assert.match(html, /融合甘特图与思维导图的可穿透项目计划工具/);
  }
});

test("ships the planning canvas, project library, and runnable instructions", async () => {
  const [home, tool, library, projectsPage, readme] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/PlanTool.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ProjectLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);
  assert.match(home, /<PlanTool/);
  assert.match(tool, /PlanThrough/);
  assert.match(tool, /拖动修改模式/);
  assert.match(tool, /project-celebration/);
  assert.match(library, /PROJECTS_KEY|planthrough-projects/);
  assert.match(projectsPage, /<ProjectLibrary/);
  assert.match(readme, /npm install/);
  assert.match(readme, /npm run dev/);
});
