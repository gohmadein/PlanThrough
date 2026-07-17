"use client";

import { useEffect, useMemo, useState } from "react";

type ProjectSummary = {
  id: string;
  name: string;
  start: string;
  end: string;
  updatedAt?: string;
  nodes?: unknown[];
  attachments?: { id: string }[];
};

const KEY = "planthrough-projects";

async function removeStoredFiles(ids: string[]) {
  if (!ids.length) return;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("planthrough-files", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    ids.forEach((id) => tx.objectStore("files").delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export default function ProjectLibrary() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    try {
      setProjects(JSON.parse(localStorage.getItem(KEY) || "[]"));
    } catch {
      setProjects([]);
    }
  }, []);
  const visible = useMemo(
    () => projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase())),
    [projects, query],
  );
  const remove = async (project: ProjectSummary) => {
    if (!confirm(`删除项目“${project.name}”？项目节点和本机附件都会被删除。`)) return;
    await removeStoredFiles((project.attachments || []).map((file) => file.id));
    const next = projects.filter((item) => item.id !== project.id);
    setProjects(next);
    localStorage.setItem(KEY, JSON.stringify(next));
    try {
      const current = JSON.parse(localStorage.getItem("planthrough-project") || "null") as ProjectSummary | null;
      if (current?.id === project.id) {
        if (next[0]) localStorage.setItem("planthrough-project", JSON.stringify(next[0]));
        else localStorage.removeItem("planthrough-project");
      }
    } catch {}
  };
  return (
    <main className="library-page">
      <header className="library-topbar">
        <div className="brand"><div className="brand-mark">P↘</div><div><strong>项目查看</strong><small>PlanThrough 项目库</small></div></div>
        <a className="btn" href="/">返回当前画布</a>
      </header>
      <section className="library-content">
        <div className="library-heading">
          <div><span className="eyebrow">PROJECT LIBRARY</span><h1>所有项目</h1><p>新项目不会覆盖旧项目；点击“新页面打开”可以同时查看多个项目。</p></div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索项目名称" aria-label="搜索项目" />
        </div>
        <div className="project-grid">
          {visible.map((project) => (
            <article className="project-card" key={project.id}>
              <div className="project-card-mark">{project.name.slice(0, 1) || "P"}</div>
              <div className="project-card-main">
                <h2>{project.name}</h2>
                <p>{project.start} — {project.end}</p>
                <div className="project-card-stats"><span>{project.nodes?.length || 0} 个节点</span><span>{project.attachments?.length || 0} 个文件</span></div>
                <small>最近更新：{project.updatedAt ? new Date(project.updatedAt).toLocaleString("zh-CN") : "暂无"}</small>
              </div>
              <div className="project-card-actions">
                <button className="btn primary" onClick={() => window.open(`/?project=${project.id}`, "_blank")}>新页面打开</button>
                <button className="btn danger" onClick={() => remove(project)}>删除</button>
              </div>
            </article>
          ))}
          {!visible.length && <div className="library-empty"><b>还没有匹配的项目</b><p>回到画布创建一个新项目，它会自动出现在这里。</p></div>}
        </div>
      </section>
    </main>
  );
}
