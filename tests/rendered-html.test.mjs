import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders PlanThrough routes and product metadata", async () => {
  for (const pathname of ["/", "/projects"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /PlanThrough/);
    assert.match(html, /一张图，无限穿透/);
  }
});

test("ships the workflow canvas, working panel, and project library", async () => {
  const [tool, library, readme] = await Promise.all([readFile(new URL("../app/PlanTool.tsx", import.meta.url), "utf8"), readFile(new URL("../app/ProjectLibrary.tsx", import.meta.url), "utf8"), readFile(new URL("../README.md", import.meta.url), "utf8")]);
  assert.match(tool, /新建节点/);
  assert.match(tool, /逻辑线/);
  assert.match(tool, /关系线/);
  assert.match(tool, /节点的审批流及成果提交/);
  assert.match(tool, /全部末端逻辑节点完成后才能结束项目/);
  assert.match(tool, /isPendingExecutable/);
  assert.match(tool, /项目工作台/);
  assert.match(tool, /整体节点完成率/);
  assert.match(tool, /当前审批状态|审批/);
  assert.match(tool, /floating-timeline/);
  assert.match(tool, /局部时间/);
  assert.match(tool, /当前任务/);
  assert.match(library, /planthrough-projects-v2/);
  assert.match(readme, /npm install/);
  assert.match(readme, /npm run dev/);
});
