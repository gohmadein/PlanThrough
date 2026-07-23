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
  const [tool, library, readme, extras] = await Promise.all([readFile(new URL("../app/PlanTool.tsx", import.meta.url), "utf8"), readFile(new URL("../app/ProjectLibrary.tsx", import.meta.url), "utf8"), readFile(new URL("../README.md", import.meta.url), "utf8"), readFile(new URL("../app/extras.css", import.meta.url), "utf8")]);
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
  assert.match(tool, /未存在一条由起点连接到终点的有效逻辑通路/);
  assert.match(tool, /继续/);
  assert.match(tool, /暂停/);
  assert.match(tool, /展开全部/);
  assert.match(tool, /关闭全部/);
  assert.match(tool, /返回全局/);
  assert.match(tool, /visibleExitIds/);
  assert.match(tool, /上传附件/);
  assert.match(tool, /点击发起/);
  assert.match(tool, /通过\/退回/);
  assert.match(tool, /toggleCanvasTool/);
  assert.match(tool, /hasOtherKindBetweenSameNodes/);
  assert.match(tool, /canOpenFrame/);
  assert.match(tool, /删除模式：点击逻辑线或关系线即可删除/);
  assert.match(tool, /tool !== "delete"/);
  assert.match(tool, /双击日期区域修改/);
  assert.match(tool, /新的项目周期必须包含节点/);
  assert.match(tool, /workspace-help-button/);
  assert.match(tool, /PlanThrough 使用帮助/);
  assert.match(tool, /起点和终点也是逻辑连接点/);
  assert.match(tool, /起点 → 第一个一级节点/);
  assert.match(tool, /nodeMetrics/);
  assert.match(tool, /durationWidth/);
  assert.match(tool, /并发时间线/);
  assert.doesNotMatch(tool, /className="node-time-line"/);
  assert.match(tool, /className="approve"[\s\S]*className="rejection-row"/);
  assert.match(library, /planthrough-projects-v2/);
  assert.match(readme, /npm install/);
  assert.match(readme, /npm run dev/);
  assert.match(extras, /\.plan-node\.pending[\s\S]*filter: none/);
  assert.match(extras, /\.canvas\.draft \.plan-node \.traffic-lights i/);
  assert.match(extras, /\.workspace-help-button/);
  assert.match(extras, /\.help-modal/);
});
