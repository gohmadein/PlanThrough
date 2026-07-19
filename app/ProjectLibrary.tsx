"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ProjectSummary = {
  id: string;
  name: string;
  start: string;
  end: string;
  status?: "draft" | "running" | "paused" | "completed";
  updatedAt?: string;
  nodes?: { status?: string }[];
  attachments?: { id: string }[];
};

const PROJECTS_KEY = "planthrough-projects-v2";

async function removeStoredFiles(ids: string[]) {
  if (!ids.length) return;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("planthrough-files-v2", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve) => {
    const tx = db.transaction("files", "readwrite");
    ids.forEach((id) => tx.objectStore("files").delete(id));
    tx.oncomplete = () => resolve();
  });
  db.close();
}

export default function ProjectLibrary() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setProjects(JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]")); }
      catch { setProjects([]); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const visible = useMemo(() => projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase())), [projects, query]);
  const remove = async (project: ProjectSummary) => {
    if (!window.confirm(`删除项目“${project.name}”？项目节点和本机附件都会被删除。`)) return;
    await removeStoredFiles((project.attachments || []).map((file) => file.id));
    const next = projects.filter((item) => item.id !== project.id);
    setProjects(next);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
  };
  return <main className="library-page">
    <header className="library-topbar"><div className="brand"><div className="brand-mark">P↘</div><div><strong>项目查看</strong><small>PlanThrough 项目库</small></div></div><Link className="btn" href="/">返回当前画布</Link></header>
    <section className="library-content">
      <div className="library-heading"><div><span className="eyebrow">PROJECT LIBRARY</span><h1>所有项目</h1><p>每个项目都可以在独立页面打开，继续设计、执行或查看结果。</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称" aria-label="搜索项目" /></div>
      <div className="project-grid">
        {visible.map((project) => {
          const completed = project.nodes?.filter((node) => node.status === "completed").length || 0;
          return <article className="project-card" key={project.id}><div className="project-card-mark">{project.name.slice(0, 1) || "P"}</div><div className="project-card-main"><h2>{project.name}</h2><p>{project.start} → {project.end}</p><div className="project-card-stats"><span>{project.nodes?.length || 0} 个节点</span><span>{completed} 个已完成</span><span>{project.attachments?.length || 0} 个文件</span><span>{project.status === "running" ? "执行中" : project.status === "paused" ? "已暂停" : project.status === "completed" ? "已完成" : "设计中"}</span></div><small>最近更新：{project.updatedAt ? new Date(project.updatedAt).toLocaleString("zh-CN") : "暂无"}</small></div><div className="project-card-actions"><button className="btn primary" onClick={() => window.open(`/?project=${project.id}`, "_blank")}>新页面打开</button><button className="btn danger" onClick={() => remove(project)}>删除</button></div></article>;
        })}
        {!visible.length && <div className="library-empty"><b>还没有匹配的项目</b><p>返回画布创建一个新项目，它会自动出现在这里。</p></div>}
      </div>
    </section>
  </main>;
}
