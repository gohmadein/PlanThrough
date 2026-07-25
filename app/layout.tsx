import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./extras.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://planthrough-workflow.lmx71017.chatgpt.site"),
  title: "PlanThrough 公开体验版 · 一张图，无限穿透",
  description: "融合时间轴、递归节点和顺序工作流的可穿透项目执行工具。立即打开体验，并把你的使用意见告诉我们。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "PlanThrough · 一张图，无限穿透",
    description: "在一张画布中设计时间、拆解任务、连接流程并推进执行。公开体验版现已开放。",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.png", width: 1680, height: 945, alt: "PlanThrough 公开体验版" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PlanThrough · 一张图，无限穿透",
    description: "时间轴、递归节点和执行流程都在一张画布中。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
