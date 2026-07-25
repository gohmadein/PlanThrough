"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type FeedbackItem = {
  id: string;
  createdAt: string;
  category: string;
  description: string;
  expected: string;
  contact: string;
  projectName: string;
  appVersion: string;
  pageUrl: string;
  userAgent: string;
  viewport: string;
  screenshotName: string | null;
};

export default function FeedbackAdminPage() {
  const [key, setKey] = useState(() => typeof window === "undefined" ? "" : sessionStorage.getItem("planthrough-feedback-admin-key") || "");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const imageUrlsRef = useRef<string[]>([]);

  useEffect(() => () => {
    imageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const loadFeedback = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/feedback", { headers: { "x-feedback-admin-key": key } });
      const payload = await response.json() as { feedback?: FeedbackItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "读取失败");
      setItems(payload.feedback || []);
      sessionStorage.setItem("planthrough-feedback-admin-key", key);
    } catch (reason) {
      setItems([]);
      setError(reason instanceof Error ? reason.message : "读取失败");
    } finally {
      setLoading(false);
    }
  };

  const loadScreenshot = async (item: FeedbackItem) => {
    if (imageUrls[item.id]) return;
    setError("");
    try {
      const response = await fetch(`/api/feedback/${item.id}/screenshot`, {
        headers: { "x-feedback-admin-key": key },
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error || "截图读取失败");
      }
      const url = URL.createObjectURL(await response.blob());
      imageUrlsRef.current.push(url);
      setImageUrls((current) => ({ ...current, [item.id]: url }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "截图读取失败");
    }
  };

  return <main className="feedback-admin">
    <header>
      <Link href="/">← 返回 PlanThrough</Link>
      <div><small>PLAN THROUGH BETA</small><h1>体验反馈管理</h1><p>最近 200 条公开体验反馈，仅管理员口令可以读取。</p></div>
    </header>

    <section className="feedback-login">
      <label>管理员口令<input type="password" value={key} onChange={(event) => setKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadFeedback(); }} /></label>
      <button disabled={!key || loading} onClick={() => void loadFeedback()}>{loading ? "正在读取…" : "查看反馈"}</button>
    </section>

    {error && <div className="feedback-admin-error">{error}</div>}
    <div className="feedback-admin-summary"><b>{items.length}</b><span>条反馈</span></div>

    <section className="feedback-cards">
      {items.map((item) => <article key={item.id}>
        <header><span>{item.category}</span><time>{new Date(item.createdAt).toLocaleString("zh-CN")}</time></header>
        <h2>{item.projectName || "未提供项目名称"}</h2>
        <h3>问题描述</h3><p>{item.description}</p>
        {item.expected && <><h3>期望效果</h3><p>{item.expected}</p></>}
        <dl>
          <div><dt>联系方式</dt><dd>{item.contact || "未填写"}</dd></div>
          <div><dt>版本</dt><dd>{item.appVersion}</dd></div>
          <div><dt>屏幕</dt><dd>{item.viewport || "未知"}</dd></div>
          <div><dt>浏览器</dt><dd title={item.userAgent}>{item.userAgent || "未知"}</dd></div>
        </dl>
        {item.screenshotName && <div className="feedback-screenshot">
          {imageUrls[item.id]
            ? <a href={imageUrls[item.id]} target="_blank" rel="noreferrer"><Image unoptimized width={900} height={520} src={imageUrls[item.id]} alt={`${item.category}反馈截图`} /></a>
            : <button onClick={() => void loadScreenshot(item)}>查看截图 · {item.screenshotName}</button>}
        </div>}
      </article>)}
      {!loading && !error && !items.length && <div className="feedback-empty">输入管理员口令后即可查看体验反馈。</div>}
    </section>
  </main>;
}
