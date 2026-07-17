"use client";

import {
  ChangeEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Risk = "green" | "yellow" | "red";
type DependencyType = "finish-start" | "parallel";
type Category = { id: string; name: string; color: string };
type Dependency = { from: string; to: string; type: DependencyType };
type AttachmentMeta = {
  id: string;
  nodeId: string;
  name: string;
  size: number;
  type: string;
  addedAt: string;
};
type PlanNode = {
  id: string;
  parentId: string | null;
  title: string;
  categoryId: string;
  start: string;
  end: string;
  progress: number;
  weight: number;
  risk: Risk;
};
type Project = {
  version: 1;
  id: string;
  name: string;
  start: string;
  end: string;
  createdAt: string;
  updatedAt: string;
  categories: Category[];
  nodes: PlanNode[];
  dependencies: Dependency[];
  attachments: AttachmentMeta[];
  startedAt?: string;
  completedAt?: string;
};
type Positioned = {
  node: PlanNode;
  x: number;
  y: number;
  width: number;
  level: number;
  row: number;
  concurrency?: "same" | "cross";
};
type ExpansionFrame = {
  id: string;
  parentId: string;
  level: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bands: { categoryId: string; y: number; height: number }[];
};
type DragKind = "move" | "resize-start" | "resize-end";
type DragSession = {
  nodeId: string;
  kind: DragKind;
  startX: number;
  base: Project;
};
type FloatingTip = { x: number; y: number; text: string };

const nodeHeight = (level: number) => level === 0 ? 60 : level === 1 ? 56 : 54;

const DAY = 86_400_000;
const COLORS = [
  "#246bfd",
  "#27a779",
  "#8b6ce2",
  "#e3992d",
  "#e05e70",
  "#2b9db5",
];
const riskRank: Record<Risk, number> = { green: 0, yellow: 1, red: 2 };
const uid = () => Math.random().toString(36).slice(2, 9);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const parse = (value: string) => new Date(`${value}T00:00:00`).getTime();
const localDate = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const overlap = (a: PlanNode, b: PlanNode) =>
  Math.max(parse(a.start), parse(b.start)) <
  Math.min(parse(a.end), parse(b.end));
const formatShort = (value: string) => value.slice(5).replace("-", "/");
const formatSize = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const PROJECTS_KEY = "planthrough-projects";

function normalizeProject(value: Partial<Project>): Project {
  const now = new Date().toISOString();
  return {
    ...(value as Project),
    version: 1,
    id: value.id || `project-${uid()}`,
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
    attachments: value.attachments || [],
    dependencies: value.dependencies || [],
  };
}

function readProjectCollection(): Project[] {
  try {
    return (JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]") as Project[]).map(normalizeProject);
  } catch {
    return [];
  }
}

function upsertProject(project: Project) {
  const projects = readProjectCollection();
  const next = { ...project, updatedAt: new Date().toISOString() };
  const index = projects.findIndex((item) => item.id === next.id);
  if (index >= 0) projects[index] = next;
  else projects.unshift(next);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function openFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("planthrough-files", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeFile(id: string, file: File) {
  const db = await openFileDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readStoredFile(id: string): Promise<Blob | undefined> {
  const db = await openFileDb();
  const result = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction("files", "readonly").objectStore("files").get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function deleteStoredFile(id: string) {
  const db = await openFileDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function demoProject(
  count = 7,
  name = "新品上市计划",
  start = "2026-07-01",
  end = "2026-12-31",
  categoryNames = ["Thinking", "Doing", "Acting"],
): Project {
  const categories = categoryNames.map((item, index) => ({
    id: `cat-${index + 1}`,
    name: item,
    color: COLORS[index % COLORS.length],
  }));
  const names = [
    "目标与范围",
    "用户研究",
    "方案设计",
    "核心开发",
    "联调验证",
    "试点发布",
    "正式交付",
    "运营复盘",
    "规模推广",
    "项目收尾",
  ];
  const startMs = parse(start),
    total = Math.max(DAY, parse(end) - startMs),
    nodes: PlanNode[] = [];
  for (let i = 0; i < count; i++) {
    const s = startMs + total * (i / Math.max(count, 1)) * 0.88,
      duration = total * (1.15 / Math.max(count, 1));
    nodes.push({
      id: `root-${i + 1}`,
      parentId: null,
      title: names[i] || `核心步骤 ${i + 1}`,
      categoryId: categories[i % categories.length].id,
      start: isoDate(new Date(s)),
      end: isoDate(new Date(Math.min(parse(end), s + duration))),
      progress: 0,
      weight: 1,
      risk: i === 3 ? "yellow" : "green",
    });
  }
  if (nodes[1]) {
    const p = nodes[1],
      ps = parse(p.start),
      span = parse(p.end) - ps;
    [
      ["访谈提纲", 0, 0.32, 0],
      ["用户访谈", 0.22, 0.68, 1],
      ["洞察归纳", 0.62, 1, 0],
    ].forEach((x, i) =>
      nodes.push({
        id: `child-${i + 1}`,
        parentId: p.id,
        title: String(x[0]),
        categoryId: categories[Number(x[3]) % categories.length].id,
        start: isoDate(new Date(ps + span * Number(x[1]))),
        end: isoDate(new Date(ps + span * Number(x[2]))),
        progress: 0,
        weight: i === 1 ? 2 : 1,
        risk: i === 1 ? "yellow" : "green",
      }),
    );
  }
  const roots = nodes.filter((n) => !n.parentId);
  const dependencies: Dependency[] = roots
    .slice(1)
    .map((n, i) => ({
      from: roots[i].id,
      to: n.id,
      type: i === 2 ? "parallel" : "finish-start",
    }));
  const now = new Date().toISOString();
  return { version: 1, id: `project-${uid()}`, name, start, end, createdAt: now, updatedAt: now, categories, nodes, dependencies, attachments: [] };
}

function descendants(project: Project, parentId: string): PlanNode[] {
  const direct = project.nodes.filter((n) => n.parentId === parentId);
  return direct.flatMap((n) => [n, ...descendants(project, n.id)]);
}
function orderedChildren(project: Project, parentId: string | null): PlanNode[] {
  return project.nodes
    .filter((node) => node.parentId === parentId)
    .slice()
    .sort((a, b) => parse(a.start) - parse(b.start) || parse(a.end) - parse(b.end) || a.id.localeCompare(b.id));
}
function executionLeaves(project: Project): PlanNode[] {
  const visit = (node: PlanNode): PlanNode[] => {
    const children = orderedChildren(project, node.id);
    return children.length ? children.flatMap(visit) : [node];
  };
  return orderedChildren(project, null).flatMap(visit);
}
function ancestorIds(project: Project, node: PlanNode): string[] {
  const ids: string[] = [];
  let parentId = node.parentId;
  while (parentId) {
    ids.push(parentId);
    parentId = project.nodes.find((item) => item.id === parentId)?.parentId || null;
  }
  return ids;
}
function computedProgress(project: Project, node: PlanNode): number {
  const children = project.nodes.filter((n) => n.parentId === node.id);
  if (!children.length) return node.progress;
  const total = children.reduce((s, c) => s + c.weight, 0) || 1;
  return Math.round(
    children.reduce((s, c) => s + computedProgress(project, c) * c.weight, 0) /
      total,
  );
}
function computedRisk(project: Project, node: PlanNode): Risk {
  const children = project.nodes.filter((n) => n.parentId === node.id);
  const progress = computedProgress(project, node);
  if (progress >= 100) return "green";
  const todayStart = parse(isoDate(new Date()));
  const overdue: Risk = parse(node.end) < todayStart ? "red" : node.risk;
  return children.reduce<Risk>((worst, child) => {
    const next = computedRisk(project, child);
    return riskRank[next] > riskRank[worst] ? next : worst;
  }, overdue);
}
function depth(project: Project, node: PlanNode): number {
  let d = 0,
    current = node;
  while (current.parentId) {
    const parent = project.nodes.find((n) => n.id === current.parentId);
    if (!parent) break;
    current = parent;
    d++;
  }
  return d;
}

export default function PlanTool() {
  const [project, setProject] = useState<Project>(() => demoProject());
  const [ready, setReady] = useState(false),
    [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["root-2"]));
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [zoom, setZoom] = useState(1),
    [error, setError] = useState("");
  const [attachmentNodeId, setAttachmentNodeId] = useState<string | null>(null);
  const [canvasScrollLeft, setCanvasScrollLeft] = useState(0);
  const [dragMode, setDragMode] = useState(false);
  const [dragDirty, setDragDirty] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [floatingTip, setFloatingTip] = useState<FloatingTip | null>(null);
  const [completionPulseIds, setCompletionPulseIds] = useState<Set<string>>(new Set());
  const [celebrating, setCelebrating] = useState(false);
  const dragSnapshotRef = useRef<Project | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const focusedWorkflowNodeRef = useRef<string | null>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const attachmentFileRef = useRef<HTMLInputElement>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let projects = readProjectCollection();
    const legacy = localStorage.getItem("planthrough-project");
    if (!projects.length && legacy) {
      try {
        const migrated = normalizeProject(JSON.parse(legacy));
        projects = [migrated];
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
      } catch {}
    }
    const requestedId = new URLSearchParams(window.location.search).get("project");
    const requested = projects.find((item) => item.id === requestedId);
    if (requested || projects[0]) setProject(requested || projects[0]);
    else setShowCreate(true);
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready && !dragMode) {
      localStorage.setItem("planthrough-project", JSON.stringify(project));
      upsertProject(project);
    }
  }, [project, ready, dragMode]);
  useEffect(() => {
    if (!dragMode || !dragDirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dragMode, dragDirty]);

  const selected = project.nodes.find((n) => n.id === selectedId) || null;
  const childrenMap = useMemo(
    () =>
      new Map(
        project.nodes.map((n) => [
          n.id,
          project.nodes.filter((c) => c.parentId === n.id),
        ]),
      ),
    [project.nodes],
  );
  const workflowLeaves = useMemo(() => executionLeaves(project), [project]);
  const activeLeaf = project.startedAt
    ? workflowLeaves.find((node) => computedProgress(project, node) < 100) || null
    : null;
  const activePath = useMemo(() => {
    if (!activeLeaf) return new Set<string>();
    return new Set([activeLeaf.id, ...ancestorIds(project, activeLeaf)]);
  }, [project, activeLeaf?.id]);
  const projectReadyToFinish = Boolean(
    project.startedAt && workflowLeaves.length && workflowLeaves.every((node) => computedProgress(project, node) >= 100),
  );
  useEffect(() => {
    if (!activeLeaf) return;
    const path = [activeLeaf.id, ...ancestorIds(project, activeLeaf)];
    setExpanded((current) => {
      const next = new Set(current);
      let changed = false;
      for (const id of path) {
        if ((childrenMap.get(id)?.length || 0) > 0 && !next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activeLeaf?.id, childrenMap, project]);
  const visibleNodes = useMemo(
    () =>
      project.nodes.filter((node) => {
        let current = node;
        while (current.parentId) {
          if (!expanded.has(current.parentId)) return false;
          const parent = project.nodes.find((n) => n.id === current.parentId);
          if (!parent) return false;
          current = parent;
        }
        return true;
      }),
    [project.nodes, expanded],
  );
  const baseWidth = Math.max(1180, 1600 * zoom),
    leftPad = 118,
    rightPad = 80,
    plotWidth = baseWidth - leftPad - rightPad;
  const range = Math.max(DAY, parse(project.end) - parse(project.start));
  const px = (date: string) =>
    leftPad +
    clamp((parse(date) - parse(project.start)) / range, 0, 1) * plotWidth;

  const layout = useMemo(() => {
    const result: Positioned[] = [];
    const frames: ExpansionFrame[] = [];
    const laneInfo: { id: string; top: number; height: number }[] = [];
    const measureMemo = new Map<string, number>();
    const nodeWidth = (node: PlanNode, level: number) =>
      Math.max(level === 0 ? 120 : 104, px(node.end) - px(node.start));
    const directChildren = (parentId: string) =>
      project.nodes.filter((node) => node.parentId === parentId);
    const measureFrame = (parentId: string): number => {
      if (!expanded.has(parentId)) return 0;
      if (measureMemo.has(parentId)) return measureMemo.get(parentId)!;
      const children = directChildren(parentId);
      if (!children.length) return 0;
      let height = 24;
      for (const category of project.categories) {
        const categoryChildren = children.filter((node) => node.categoryId === category.id);
        if (!categoryChildren.length && !dragMode) continue;
        height += categoryChildren.length ? 28 : 46;
        for (const child of categoryChildren)
          height += nodeHeight(depth(project, child)) + 18 + measureFrame(child.id);
      }
      height += 46;
      measureMemo.set(parentId, height);
      return height;
    };
    const visibleDescendants = (parentId: string): PlanNode[] => {
      if (!expanded.has(parentId)) return [];
      return directChildren(parentId).flatMap((child) => [child, ...visibleDescendants(child.id)]);
    };
    const placeFrame = (parent: Positioned, top: number) => {
      const frameHeight = measureFrame(parent.node.id);
      if (!frameHeight) return;
      const descendantsInFrame = visibleDescendants(parent.node.id);
      const left = Math.min(parent.x, ...descendantsInFrame.map((node) => px(node.start))) - 12;
      const right = Math.max(
        parent.x + parent.width,
        ...descendantsInFrame.map((node) => px(node.start) + nodeWidth(node, depth(project, node))),
      ) + 12;
      const bands: ExpansionFrame["bands"] = [];
      let cursor = top + 20;
      const children = directChildren(parent.node.id);
      for (const category of project.categories) {
        const categoryChildren = children
          .filter((node) => node.categoryId === category.id)
          .sort((a, b) => parse(a.start) - parse(b.start));
        if (!categoryChildren.length && !dragMode) continue;
        const bandTop = cursor;
        cursor += categoryChildren.length ? 28 : 46;
        for (const child of categoryChildren) {
          const level = depth(project, child);
          const item: Positioned = {
            node: child,
            x: px(child.start),
            y: cursor,
            width: nodeWidth(child, level),
            level,
            row: 0,
            concurrency: project.nodes.some((node) => node.id !== child.id && node.parentId === child.parentId && overlap(node, child)) ? "same" : undefined,
          };
          result.push(item);
          const nestedHeight = measureFrame(child.id);
          if (nestedHeight) placeFrame(item, cursor + nodeHeight(level) + 10);
          cursor += nodeHeight(level) + 18 + nestedHeight;
        }
        bands.push({ categoryId: category.id, y: bandTop, height: cursor - bandTop });
      }
      frames.push({ id: `frame-${parent.node.id}`, parentId: parent.node.id, level: parent.level + 1, x: left, y: top, width: right - left, height: frameHeight, bands });
    };

    let laneTop = 0;
    for (const category of project.categories) {
      const roots = project.nodes
        .filter((node) => !node.parentId && node.categoryId === category.id)
        .sort((a, b) => parse(a.start) - parse(b.start));
      let cursor = laneTop + 44;
      for (const root of roots) {
        const item: Positioned = {
          node: root,
          x: px(root.start),
          y: cursor,
          width: nodeWidth(root, 0),
          level: 0,
          row: 0,
          concurrency: project.nodes.some((node) => node.id !== root.id && !node.parentId && overlap(node, root)) ? "same" : undefined,
        };
        result.push(item);
        const frameHeight = measureFrame(root.id);
        if (frameHeight) placeFrame(item, cursor + nodeHeight(0) + 10);
        cursor += nodeHeight(0) + 24 + frameHeight;
      }
      const height = Math.max(148, cursor - laneTop + 20);
      laneInfo.push({ id: category.id, top: laneTop, height });
      laneTop += height;
    }
    return { nodes: result, frames, lanes: laneInfo, height: laneTop + 96 };
  }, [expanded, project.categories, project.nodes, baseWidth, dragMode]);
  useEffect(() => {
    if (!activeLeaf || focusedWorkflowNodeRef.current === activeLeaf.id) return;
    const item = layout.nodes.find((positioned) => positioned.node.id === activeLeaf.id);
    const scroll = canvasScrollRef.current;
    if (!item || !scroll) return;
    focusedWorkflowNodeRef.current = activeLeaf.id;
    setSelectedId(activeLeaf.id);
    window.requestAnimationFrame(() => {
      scroll.scrollTo({
        left: Math.max(0, item.x - scroll.clientWidth * 0.42),
        top: Math.max(0, item.y - scroll.clientHeight * 0.38),
        behavior: "smooth",
      });
    });
  }, [activeLeaf?.id, layout.nodes]);

  const axis = useMemo(() => {
    const ticks: { date: string; label: string }[] = [];
    const dayPixels = plotWidth / (range / DAY);
    let unit: "day" | "week" | "month" | "quarter" | "year" | "multi-year";
    if (dayPixels >= 72) unit = "day";
    else if (dayPixels * 7 >= 88) unit = "week";
    else if (dayPixels * 30 >= 88) unit = "month";
    else if (dayPixels * 91 >= 88) unit = "quarter";
    else if (dayPixels * 365 >= 88) unit = "year";
    else unit = "multi-year";

    const endMs = parse(project.end);
    let cursor = new Date(`${project.start}T00:00:00`);
    const push = (date: Date, label: string) => {
      if (date.getTime() >= parse(project.start) && date.getTime() <= endMs)
        ticks.push({ date: isoDate(date), label });
    };

    if (unit === "day" || unit === "week") {
      const step = unit === "day" ? 1 : 7;
      for (; cursor.getTime() <= endMs; cursor = new Date(cursor.getTime() + step * DAY))
        push(cursor, `${cursor.getMonth() + 1}/${cursor.getDate()}`);
    } else if (unit === "month") {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      if (cursor.getTime() < parse(project.start)) cursor.setMonth(cursor.getMonth() + 1);
      for (; cursor.getTime() <= endMs; cursor.setMonth(cursor.getMonth() + 1))
        push(cursor, `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`);
    } else if (unit === "quarter") {
      cursor = new Date(cursor.getFullYear(), Math.ceil(cursor.getMonth() / 3) * 3, 1);
      if (cursor.getTime() < parse(project.start)) cursor.setMonth(cursor.getMonth() + 3);
      for (; cursor.getTime() <= endMs; cursor.setMonth(cursor.getMonth() + 3))
        push(cursor, `${cursor.getFullYear()} Q${Math.floor(cursor.getMonth() / 3) + 1}`);
    } else {
      const yearPixels = dayPixels * 365;
      const step = unit === "multi-year" ? Math.max(2, Math.ceil(88 / yearPixels)) : 1;
      cursor = new Date(cursor.getFullYear() + (cursor.getMonth() ? 1 : 0), 0, 1);
      for (; cursor.getTime() <= endMs; cursor.setFullYear(cursor.getFullYear() + step))
        push(cursor, `${cursor.getFullYear()}年`);
    }
    const labels = { day: "日", week: "周", month: "月", quarter: "季度", year: "年", "multi-year": "年" };
    return { ticks, label: labels[unit] };
  }, [project.start, project.end, plotWidth, range]);

  const siblingLinks = useMemo(() => {
    const groups = new Map<string, Positioned[]>();
    for (const item of layout.nodes) {
      const key = item.node.parentId || "__root__";
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    const links: { key: string; from: Positioned; to: Positioned; level: number }[] = [];
    for (const siblings of groups.values()) {
      siblings.sort((a, b) => parse(a.node.start) - parse(b.node.start) || a.y - b.y);
      for (let i = 0; i < siblings.length - 1; i++)
        links.push({ key: `sibling-${siblings[i].node.id}-${siblings[i + 1].node.id}`, from: siblings[i], to: siblings[i + 1], level: siblings[i].level });
    }
    return links;
  }, [layout.nodes]);

  const concurrencyGuides = useMemo(() => {
    const guides: { key: string; x1: number; x2: number; type: "same" | "cross"; label: string }[] = [];
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i], b = layout.nodes[j];
        if (!overlap(a.node, b.node)) continue;
        const related = descendants(project, a.node.id).some((node) => node.id === b.node.id) || descendants(project, b.node.id).some((node) => node.id === a.node.id);
        if (related) continue;
        const start = Math.max(parse(a.node.start), parse(b.node.start));
        const end = Math.min(parse(a.node.end), parse(b.node.end));
        guides.push({
          key: `${a.node.id}-${b.node.id}`,
          x1: leftPad + ((start - parse(project.start)) / range) * plotWidth,
          x2: leftPad + ((end - parse(project.start)) / range) * plotWidth,
          type: a.node.parentId === b.node.parentId ? "same" : "cross",
          label: `${a.node.title} 与 ${b.node.title} 并发：${isoDate(new Date(start))} 至 ${isoDate(new Date(end))}`,
        });
      }
    }
    return guides;
  }, [layout.nodes, project, plotWidth, range]);

  const getFrameAxis = (frame: ExpansionFrame) => {
    const parent = project.nodes.find((node) => node.id === frame.parentId);
    if (!parent) return { label: "日", ticks: [] as { x: number; label: string }[] };
    let unit = axis.label;
    for (let i = 0; i < frame.level; i++)
      unit = unit === "年" || unit === "季度" ? "月" : "日";
    const ticks: { x: number; label: string }[] = [];
    if (unit === "月") {
      let cursor = new Date(`${parent.start}T00:00:00`);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      if (cursor.getTime() < parse(parent.start)) cursor.setMonth(cursor.getMonth() + 1);
      for (; cursor.getTime() <= parse(parent.end); cursor.setMonth(cursor.getMonth() + 1))
        ticks.push({ x: px(isoDate(cursor)) - frame.x, label: `${cursor.getMonth() + 1}月` });
    } else {
      const days = Math.max(1, Math.ceil((parse(parent.end) - parse(parent.start)) / DAY));
      const targetCount = Math.max(2, Math.floor(frame.width / 64));
      const step = Math.max(1, Math.ceil(days / targetCount));
      for (let time = parse(parent.start); time <= parse(parent.end); time += step * DAY) {
        const date = new Date(time);
        ticks.push({ x: px(isoDate(date)) - frame.x, label: `${date.getMonth() + 1}/${date.getDate()}` });
      }
    }
    return { label: unit, ticks };
  };

  const enterDragMode = () => {
    dragSnapshotRef.current = JSON.parse(JSON.stringify(project));
    dragSessionRef.current = null;
    setDragDirty(false);
    setDraggingId(null);
    setSelectedId(null);
    setAttachmentNodeId(null);
    setDragMode(true);
  };
  const saveDragMode = () => {
    dragSnapshotRef.current = null;
    dragSessionRef.current = null;
    localStorage.setItem("planthrough-project", JSON.stringify(project));
    upsertProject(project);
    setDragDirty(false);
    setDraggingId(null);
    setDragMode(false);
  };
  const exitDragMode = () => {
    if (dragDirty && !confirm("退出后将放弃本次拖动修改，确定继续吗？")) return;
    if (dragSnapshotRef.current) setProject(dragSnapshotRef.current);
    dragSnapshotRef.current = null;
    dragSessionRef.current = null;
    setDragDirty(false);
    setDraggingId(null);
    setDragMode(false);
  };
  const beginNodeDrag = (
    event: ReactPointerEvent<HTMLElement>,
    node: PlanNode,
    kind: DragKind,
  ) => {
    if (!dragMode || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragSessionRef.current = {
      nodeId: node.id,
      kind,
      startX: event.clientX,
      base: JSON.parse(JSON.stringify(project)),
    };
    setDraggingId(node.id);
  };
  const startProject = () => {
    if (project.startedAt || dragMode) return;
    focusedWorkflowNodeRef.current = null;
    setProject((current) => ({
      ...current,
      startedAt: new Date().toISOString(),
      completedAt: undefined,
      nodes: current.nodes.map((node) => ({ ...node, progress: 0 })),
    }));
  };
  const finishProject = () => {
    if (!projectReadyToFinish || project.completedAt || celebrating || dragMode) return;
    setProject((current) => ({ ...current, completedAt: new Date().toISOString() }));
    setCelebrating(true);
    window.setTimeout(() => setCelebrating(false), 3600);
  };

  useEffect(() => {
    if (!dragMode) return;
    const onPointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session) return;
      const baseNode = session.base.nodes.find((node) => node.id === session.nodeId);
      if (!baseNode) return;
      const parent = baseNode.parentId
        ? session.base.nodes.find((node) => node.id === baseNode.parentId)
        : null;
      const minBound = parse(parent?.start || session.base.start);
      const maxBound = parse(parent?.end || session.base.end);
      const rawDays = Math.round(((event.clientX - session.startX) / plotWidth) * (range / DAY));
      const childNodes = descendants(session.base, baseNode.id);
      const childStart = childNodes.length ? Math.min(...childNodes.map((node) => parse(node.start))) : Infinity;
      const childEnd = childNodes.length ? Math.max(...childNodes.map((node) => parse(node.end))) : -Infinity;
      let nextNodes = session.base.nodes;

      if (session.kind === "move") {
        const subtree = [baseNode, ...childNodes];
        const earliest = Math.min(...subtree.map((node) => parse(node.start)));
        const latest = Math.max(...subtree.map((node) => parse(node.end)));
        const minDays = Math.ceil((minBound - earliest) / DAY);
        const maxDays = Math.floor((maxBound - latest) / DAY);
        const days = clamp(rawDays, minDays, maxDays);
        const affected = new Set(subtree.map((node) => node.id));
        nextNodes = session.base.nodes.map((node) =>
          affected.has(node.id)
            ? { ...node, start: localDate(parse(node.start) + days * DAY), end: localDate(parse(node.end) + days * DAY) }
            : node,
        );
      } else if (session.kind === "resize-start") {
        const latestStart = Math.min(parse(baseNode.end) - DAY, childStart);
        const time = clamp(parse(baseNode.start) + rawDays * DAY, minBound, latestStart);
        nextNodes = session.base.nodes.map((node) => node.id === baseNode.id ? { ...node, start: localDate(time) } : node);
      } else {
        const earliestEnd = Math.max(parse(baseNode.start) + DAY, childEnd);
        const time = clamp(parse(baseNode.end) + rawDays * DAY, earliestEnd, maxBound);
        nextNodes = session.base.nodes.map((node) => node.id === baseNode.id ? { ...node, end: localDate(time) } : node);
      }

      const scroll = canvasScrollRef.current;
      if (session.kind === "move" && scroll) {
        const canvasY = event.clientY - scroll.getBoundingClientRect().top + scroll.scrollTop;
        let categoryId = baseNode.categoryId;
        if (!baseNode.parentId) {
          categoryId = layout.lanes.find((lane) => canvasY >= lane.top && canvasY < lane.top + lane.height)?.id || categoryId;
        } else {
          const frame = layout.frames.find((item) => item.parentId === baseNode.parentId);
          categoryId = frame?.bands.find((band) => canvasY >= band.y && canvasY < band.y + band.height)?.categoryId || categoryId;
        }
        nextNodes = nextNodes.map((node) => node.id === baseNode.id ? { ...node, categoryId } : node);
      }
      setProject({ ...session.base, nodes: nextNodes });
      setDragDirty(true);
    };
    const onPointerUp = () => {
      dragSessionRef.current = null;
      setDraggingId(null);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragMode, layout.frames, layout.lanes, plotWidth, range]);

  const updateNode = (changes: Partial<PlanNode>) => {
    if (!selected) return;
    const next = { ...selected, ...changes },
      parent = next.parentId
        ? project.nodes.find((n) => n.id === next.parentId)
        : null;
    if (parse(next.start) >= parse(next.end))
      return setError("完成时间必须晚于开始时间。");
    if (
      parent &&
      (parse(next.start) < parse(parent.start) ||
        parse(next.end) > parse(parent.end))
    )
      return setError(
        `子节点时间必须完全位于父节点“${parent.title}”的范围内。`,
      );
    if (
      project.nodes
        .filter((n) => n.parentId === next.id)
        .some(
          (c) =>
            parse(c.start) < parse(next.start) ||
            parse(c.end) > parse(next.end),
        )
    )
      return setError("当前时间范围无法包含已有子节点，请先调整子节点。");
    setError("");
    setProject((p) => ({
      ...p,
      nodes: p.nodes.map((n) => (n.id === next.id ? next : n)),
    }));
  };
  const updateSubtreeProgress = (value: number) => {
    if (!selected) return;
    if (!project.startedAt)
      return setError("请先点击图中的“起点”启动项目。");
    if (!project.completedAt && selected.id !== activeLeaf?.id)
      return setError((childrenMap.get(selected.id)?.length || 0) > 0
        ? "父级进度由当前子任务自动归并，请完成黄色标记的任务。"
        : "该任务尚未解锁，请先完成当前黄色任务。");
    const progress = clamp(value, 0, 100);
    const affected = new Set([
      selected.id,
      ...descendants(project, selected.id).map((node) => node.id),
    ]);
    const nextProject: Project = {
      ...project,
      nodes: project.nodes.map((node) =>
        affected.has(node.id)
          ? {
              ...node,
              progress,
              risk: progress >= 100 ? "green" : node.risk,
            }
          : node,
      ),
    };
    const newlyCompleted = nextProject.nodes
      .filter((node) => computedProgress(nextProject, node) >= 100 && computedProgress(project, project.nodes.find((item) => item.id === node.id)!) < 100)
      .map((node) => node.id);
    setProject(nextProject);
    if (newlyCompleted.length) {
      setCompletionPulseIds(new Set(newlyCompleted));
      window.setTimeout(() => setCompletionPulseIds(new Set()), 1500);
    }
    setError("");
  };
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        const node = project.nodes.find((n) => n.id === id);
        if (node)
          setZoom((z) => Math.max(z, depth(project, node) === 0 ? 1.2 : 1.65));
      }
      return next;
    });
  const addChild = () => {
    if (!selected) return;
    const childCount = project.nodes.filter(
      (n) => n.parentId === selected.id,
    ).length;
    if (depth(project, selected) >= 2)
      return setError("第一版支持三级节点，当前节点已是最深层级。");
    const span = parse(selected.end) - parse(selected.start),
      start =
        parse(selected.start) + Math.min(span * 0.08 * childCount, span * 0.45);
    const node: PlanNode = {
      id: uid(),
      parentId: selected.id,
      title: `子任务 ${childCount + 1}`,
      categoryId: selected.categoryId,
      start: isoDate(new Date(start)),
      end: isoDate(
        new Date(
          Math.min(parse(selected.end), start + Math.max(DAY, span * 0.35)),
        ),
      ),
      progress: 0,
      weight: 1,
      risk: "green",
    };
    setProject((p) => ({ ...p, nodes: [...p.nodes, node] }));
    setExpanded((prev) => new Set(prev).add(selected.id));
    setSelectedId(node.id);
    setError("");
  };
  const deleteNode = async () => {
    if (!selected || !confirm(`删除“${selected.title}”及其所有子节点？`))
      return;
    const ids = new Set([
      selected.id,
      ...descendants(project, selected.id).map((n) => n.id),
    ]);
    const removedFiles = project.attachments.filter((item) => ids.has(item.nodeId));
    await Promise.all(removedFiles.map((item) => deleteStoredFile(item.id)));
    setProject((p) => ({
      ...p,
      nodes: p.nodes.filter((n) => !ids.has(n.id)),
      dependencies: p.dependencies.filter(
        (d) => !ids.has(d.from) && !ids.has(d.to),
      ),
      attachments: p.attachments.filter((item) => !ids.has(item.nodeId)),
    }));
    setSelectedId(null);
  };
  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `${project.name || "plan"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importProject = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data.nodes || !data.categories) throw new Error();
        const imported = normalizeProject({
          ...data,
          id: `project-${uid()}`,
          name: `${data.name || "导入项目"}（导入）`,
          attachments: [],
        });
        setProject(imported);
        window.history.replaceState({}, "", `/?project=${imported.id}`);
        setSelectedId(null);
        setExpanded(new Set());
      } catch {
        alert("无法读取该项目文件，请确认它是 PlanThrough 导出的 JSON 文件。");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };
  const chooseAttachments = (nodeId: string) => {
    setAttachmentNodeId(nodeId);
    window.setTimeout(() => attachmentFileRef.current?.click(), 0);
  };
  const uploadAttachments = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!attachmentNodeId || !files.length) return;
    const added: AttachmentMeta[] = [];
    for (const file of files) {
      const id = `file-${uid()}-${Date.now()}`;
      await storeFile(id, file);
      added.push({ id, nodeId: attachmentNodeId, name: file.name, size: file.size, type: file.type, addedAt: new Date().toISOString() });
    }
    setProject((p) => ({ ...p, attachments: [...p.attachments, ...added] }));
    e.target.value = "";
  };
  const downloadAttachment = async (attachment: AttachmentMeta) => {
    const blob = await readStoredFile(attachment.id);
    if (!blob) return alert("当前浏览器中找不到该文件内容，可能是从其他设备导入的项目记录。");
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = attachment.name; link.click(); URL.revokeObjectURL(url);
  };
  const removeAttachment = async (attachment: AttachmentMeta) => {
    if (!confirm(`删除文件“${attachment.name}”？`)) return;
    await deleteStoredFile(attachment.id);
    setProject((p) => ({ ...p, attachments: p.attachments.filter((item) => item.id !== attachment.id) }));
  };

  if (!ready) return null;
  const counts = project.nodes.reduce<Record<Risk, number>>(
      (acc, n) => {
        acc[computedRisk(project, n)]++;
        return acc;
      },
      { green: 0, yellow: 0, red: 0 },
    ),
    todayX = px(isoDate(new Date())),
    rootPositions = layout.nodes
      .filter((item) => !item.node.parentId)
      .slice()
      .sort((a, b) => parse(a.node.start) - parse(b.node.start)),
    startPointX = Math.max(24, (rootPositions[0]?.x || px(project.start)) - 24),
    startPointY = (rootPositions[0]?.y || 38) - 8,
    lastRootPosition = rootPositions[rootPositions.length - 1],
    endPointX = (lastRootPosition?.x || px(project.end)) + (lastRootPosition?.width || 0) + 46,
    endPointY = (lastRootPosition?.y || Math.max(38, layout.height - 110)) - 18;
  const showFloatingTip = (event: ReactPointerEvent<HTMLDivElement>, text: string) =>
    setFloatingTip({
      x: clamp(event.clientX + 14, 8, window.innerWidth - 260),
      y: clamp(event.clientY + 14, 8, window.innerHeight - 78),
      text,
    });
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">P↘</div>
          <div>
            <strong>PlanThrough</strong>
            <small>一张图，无限穿透</small>
          </div>
        </div>
        <input
          className="project-title"
          value={project.name}
          disabled={dragMode}
          onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
          aria-label="项目名称"
        />
        <div className="toolbar">
          {dragMode ? (
            <>
              <span className={`drag-mode-status ${dragDirty ? "dirty" : ""}`}>
                拖动修改模式{dragDirty ? " · 有未保存修改" : ""}
              </span>
              <button className="btn primary" onClick={saveDragMode} disabled={!dragDirty}>
                保存修改
              </button>
              <button className="btn" onClick={exitDragMode}>
                退出模式
              </button>
            </>
          ) : (
            <>
          <button className="btn" onClick={() => (window.location.href = "/projects")}>
            项目查看
          </button>
          <button className="btn" onClick={() => setShowCreate(true)}>
            ＋ 新项目
          </button>
          <button className="btn" onClick={() => projectFileRef.current?.click()}>
            导入
          </button>
          <input
            ref={projectFileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={importProject}
          />
          <input ref={attachmentFileRef} type="file" multiple hidden onChange={uploadAttachments} />
          <button className="btn" onClick={exportProject}>
            导出
          </button>
          <button className="btn drag-mode-entry" onClick={enterDragMode}>
            ↔ 拖动修改
          </button>
            </>
          )}
          <button
            className="btn icon"
            disabled={dragMode}
            onClick={() => setZoom((z) => clamp(z / 1.35, 0.25, 20))}
          >
            −
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            className="btn icon"
            disabled={dragMode}
            onClick={() => setZoom((z) => clamp(z * 1.35, 0.25, 20))}
          >
            ＋
          </button>
        </div>
      </header>
      <section className={`workspace ${selected ? "" : "inspector-closed"}`}>
        <aside className="left-panel">
          <div className="panel-title">项目总览</div>
          <div className="project-meta">
            <div className="meta-row">
              <span>项目周期</span>
              <strong>{Math.ceil(range / DAY)} 天</strong>
            </div>
            <div className="meta-row">
              <span>一级节点</span>
              <strong>
                {project.nodes.filter((n) => !n.parentId).length} 个
              </strong>
            </div>
            <div className="meta-row">
              <span>全部节点</span>
              <strong>{project.nodes.length} 个</strong>
            </div>
            <div className="meta-row">
              <span>项目文件</span>
              <strong>{project.attachments.length} 个</strong>
            </div>
            <div className="meta-row">
              <span>当前层级</span>
              <strong>
                {Math.max(0, ...visibleNodes.map((n) => depth(project, n))) + 1}{" "}
                层
              </strong>
            </div>
          </div>
          <div className="panel-title">图例</div>
          <div className="legend-list">
            <div className="legend-item">
              <span className="swatch" />
              一级核心节点
            </div>
            <div className="legend-item">
              <span className="swatch child" />
              展开的子节点
            </div>
            <div className="legend-item">
              <span className="swatch same" />
              同一父级内并发
            </div>
            <div className="legend-item">
              <span className="swatch cross" />
              跨模块并行
            </div>
            <div className="legend-item">
              <span className="swatch sibling" />
              兄弟节点连接
            </div>
          </div>
          <div className="panel-title">风险感知</div>
          <div className="risk-stack">
            <div className="risk-card green">
              <b>{counts.green}</b>正常
            </div>
            <div className="risk-card yellow">
              <b>{counts.yellow}</b>关注
            </div>
            <div className="risk-card red">
              <b>{counts.red}</b>延误
            </div>
          </div>
          <div className="panel-title workflow-legend-title">顺序执行</div>
          <div className="workflow-legend">
            <span><i className="workflow-dot locked" />未解锁</span>
            <span><i className="workflow-dot active" />当前任务</span>
            <span><i className="workflow-dot done" />已完成</span>
            <small>黄色流动箭头指向下一节点，实线箭头表示前序已经完成。</small>
          </div>
          <div className="mini-divider" />
          <p className="subtle">
            横向位置严格由开始与完成时间决定。兄弟节点发生时间重叠时，系统自动分行并标记并发。
          </p>
        </aside>
        <div className="canvas-wrap">
          <div
            className="canvas-scroll"
            ref={canvasScrollRef}
            onScroll={(e) => setCanvasScrollLeft(e.currentTarget.scrollLeft)}
          >
            <div
              className={`canvas ${dragMode ? "drag-mode" : ""}`}
              style={{ width: baseWidth, height: layout.height }}
            >
              {axis.ticks.map((t) => (
                <div
                  className="grid-line"
                  key={t.date}
                  style={{ left: px(t.date) }}
                />
              ))}
              {concurrencyGuides.flatMap((guide) => [
                <div
                  className={`concurrency-full-line ${guide.type}`}
                  key={`${guide.key}-start`}
                  style={{ left: guide.x1 }}
                  onPointerMove={(event) => showFloatingTip(event, `并发开始线\n${guide.label}`)}
                  onPointerLeave={() => setFloatingTip(null)}
                />,
                <div
                  className={`concurrency-full-line ${guide.type}`}
                  key={`${guide.key}-end`}
                  style={{ left: guide.x2 }}
                  onPointerMove={(event) => showFloatingTip(event, `并发结束线\n${guide.label}`)}
                  onPointerLeave={() => setFloatingTip(null)}
                />,
              ])}
              {todayX >= leftPad && todayX <= baseWidth - rightPad && (
                <>
                  <div
                    className="today-line"
                    style={{ left: todayX }}
                    onPointerMove={(event) => showFloatingTip(event, `当前时间线\n今天是 ${isoDate(new Date())}`)}
                    onPointerLeave={() => setFloatingTip(null)}
                  />
                  <div className="today-label" style={{ left: todayX }}>
                    今天
                  </div>
                </>
              )}
              <button
                className={`project-endpoint in-canvas start ${project.startedAt ? "started" : "ready"}`}
                style={{ left: startPointX, top: startPointY }}
                onClick={startProject}
                disabled={Boolean(project.startedAt) || dragMode}
                title={project.startedAt ? "项目已经开始" : "点击开始项目，并解锁第一个执行任务"}
              >
                <i /><span>{project.startedAt ? "已开始" : "点击开始"}</span>
              </button>
              <button
                className={`project-endpoint in-canvas end ${project.completedAt ? "completed" : projectReadyToFinish ? "ready" : "locked"}`}
                style={{ left: endPointX, top: endPointY }}
                onClick={finishProject}
                disabled={!projectReadyToFinish || Boolean(project.completedAt) || dragMode}
                title={project.completedAt ? "项目已经完成" : projectReadyToFinish ? "点击完成项目" : "完成全部任务后解锁终点"}
              >
                <i /><span>{project.completedAt ? "已完成" : projectReadyToFinish ? "完成项目" : "终点"}</span>
              </button>
              {layout.lanes.map((lane) => {
                const c = project.categories.find((x) => x.id === lane.id)!;
                return (
                  <div
                    className="lane"
                    key={lane.id}
                    style={{ top: lane.top, height: lane.height }}
                  >
                    <span className="lane-label">
                      <i className="lane-dot" style={{ background: c.color }} />
                      {c.name}
                    </span>
                  </div>
                );
              })}
              {layout.frames
                .slice()
                .sort((a, b) => a.level - b.level)
                .map((frame) => (
                  <div
                    className={`expansion-frame expansion-frame-${frame.level}`}
                    key={frame.id}
                    style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
                  >
                    <span className="frame-title">
                      {project.nodes.find((node) => node.id === frame.parentId)?.title} · 下级任务
                    </span>
                    {frame.bands.map((band) => {
                      const category = project.categories.find((item) => item.id === band.categoryId)!;
                      return (
                        <div className="frame-band" key={band.categoryId} style={{ top: band.y - frame.y, height: band.height }}>
                          <span><i style={{ background: category.color }} />{category.name}</span>
                        </div>
                      );
                    })}
                    <div className="local-frame-axis">
                      <span className="local-axis-title">局部时间 · {getFrameAxis(frame).label}</span>
                      {getFrameAxis(frame).ticks.map((tick, index) => (
                        <i key={`${frame.id}-tick-${index}`} style={{ left: tick.x }}>
                          <small>{tick.label}</small>
                        </i>
                      ))}
                    </div>
                  </div>
                ))}
              <svg
                className="dependency-layer"
                width={baseWidth}
                height={layout.height}
                aria-hidden="true"
              >
                <defs>
                  <marker id="sibling-arrow-0" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#263955" /></marker>
                  <marker id="sibling-arrow-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#2f75ed" /></marker>
                  <marker id="sibling-arrow-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8b6ce2" /></marker>
                  <marker id="workflow-arrow-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#35f29a" /></marker>
                </defs>
                {siblingLinks.map((link) => {
                  const a = link.from, b = link.to;
                  const x1 = a.x + a.width;
                  const y1 = a.y + nodeHeight(a.level) / 2;
                  const x2 = b.x;
                  const y2 = b.y + nodeHeight(b.level) / 2;
                  const bend = Math.max(26, Math.abs(x2 - x1) * 0.38);
                  const d = `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
                  const awaitingNext = activePath.has(a.node.id) && computedProgress(project, a.node) < 100;
                  return (
                    <g key={link.key}>
                      <path className={`sibling-link sibling-link-${link.level} ${awaitingNext ? "workflow-link electric" : ""}`} d={d} />
                      {completionPulseIds.has(a.node.id) && (
                        <path className="workflow-current-overlay surge" d={d} />
                      )}
                    </g>
                  );
                })}
              </svg>
              {layout.nodes.map((item) => {
                const childCount = childrenMap.get(item.node.id)?.length || 0,
                  progress = computedProgress(project, item.node),
                  nodeFiles = project.attachments.filter((file) => file.nodeId === item.node.id),
                  workflowState = progress >= 100 ? "done" : activePath.has(item.node.id) ? "active" : "locked";
                return (
                  <div
                    key={item.node.id}
                    className={`plan-node level-${item.level} workflow-${workflowState} ${selectedId === item.node.id ? "selected" : ""} ${attachmentNodeId === item.node.id ? "attachments-open" : ""} ${draggingId === item.node.id ? "dragging" : ""}`}
                    style={{ left: item.x, top: item.y, width: item.width }}
                  >
                    {dragMode && (
                      <>
                        <button
                          className="resize-handle resize-start"
                          aria-label={`修改${item.node.title}的开始时间`}
                          title="向左或向右拖动，修改开始时间"
                          onPointerDown={(event) => beginNodeDrag(event, item.node, "resize-start")}
                        />
                        <button
                          className="resize-handle resize-end"
                          aria-label={`修改${item.node.title}的完成时间`}
                          title="向左或向右拖动，修改完成时间"
                          onPointerDown={(event) => beginNodeDrag(event, item.node, "resize-end")}
                        />
                      </>
                    )}
                    {item.concurrency && (
                      <span className={`concurrency ${item.concurrency}`}>
                        {item.concurrency === "same" ? "并发" : "跨模块并行"}
                      </span>
                    )}
                    {childCount > 0 && (
                      <button
                        className="expand-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(item.node.id);
                        }}
                      >
                        {expanded.has(item.node.id) ? "−" : "+"}
                      </button>
                    )}
                    <div
                      className="node-main"
                      onPointerDown={(event) => beginNodeDrag(event, item.node, "move")}
                      onClick={() => {
                        if (dragMode) return;
                        setSelectedId(item.node.id);
                        setError("");
                      }}
                      title={dragMode ? "拖动节点可修改时间和类别；拖动两侧手柄可修改起止时间" : `${item.node.title}\n${item.node.start} — ${item.node.end}`}
                    >
                      <div className="node-title-row">
                        {item.level > 0 && (
                          <span
                            className={`hierarchy-icon hierarchy-${item.level}`}
                            title={`父节点：${project.nodes.find((node) => node.id === item.node.parentId)?.title || "未知"}`}
                          >
                            {item.level + 1}
                          </span>
                        )}
                        <i
                          className={`workflow-dot ${workflowState}`}
                          title={workflowState === "done" ? "已完成" : workflowState === "active" ? "当前执行中" : "尚未解锁"}
                        />
                        <span className="node-title">{item.node.title}</span>
                        {progress >= 100 && <span className="complete-badge">✓</span>}
                        <button
                          className={`attachment-trigger ${nodeFiles.length ? "has-files" : ""}`}
                          title="查看或上传任务文件"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAttachmentNodeId((current) => current === item.node.id ? null : item.node.id);
                          }}
                        >
                          📎{nodeFiles.length || ""}
                        </button>
                      </div>
                      <div className="node-time">
                        {formatShort(item.node.start)} →{" "}
                        {formatShort(item.node.end)} · {progress}%
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    {attachmentNodeId === item.node.id && (
                      <div className="attachment-popover" onClick={(e) => e.stopPropagation()}>
                        <div className="attachment-head">
                          <div><strong>任务文件</strong><small>共 {nodeFiles.length} 个</small></div>
                          <button onClick={() => setAttachmentNodeId(null)}>×</button>
                        </div>
                        <button className="attachment-upload" onClick={() => chooseAttachments(item.node.id)}>＋ 上传文件</button>
                        <div className="attachment-list">
                          {!nodeFiles.length && <p>还没有文件，可以上传文档、图片或压缩包。</p>}
                          {nodeFiles.map((file) => (
                            <div className="attachment-item" key={file.id}>
                              <button className="attachment-name" title={file.name} onClick={() => downloadAttachment(file)}>{file.name}</button>
                              <span>{formatSize(file.size)}</span>
                              <button className="attachment-delete" title="删除文件" onClick={() => removeAttachment(file)}>删除</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="bottom-axis-viewport">
            <div
              className="bottom-axis-track"
              style={{ width: baseWidth, transform: `translateX(${-canvasScrollLeft}px)` }}
            >
              <span className="axis-title">时间轴 · 当前刻度：{axis.label}</span>
              <span className="axis-range">{project.start} — {project.end}</span>
              {axis.ticks.map((tick) => (
                <div className="tick" key={tick.date} style={{ left: px(tick.date) }}>
                  {tick.label}
                </div>
              ))}
            </div>
          </div>
          <div className="canvas-hint">
            {dragMode
              ? "拖动节点：修改时间与类别 · 拖动左右边缘：修改起止时间 · 完成后点击保存修改"
              : "点击节点编辑 · 点击 ＋ 展开 · 滚动查看完整时间轴"}
          </div>
        </div>
        <aside className={`inspector ${selected ? "" : "empty"}`}>
          {!selected ? (
            <div className="empty-inspector">
              <div className="empty-icon">↗</div>
              <b>选择一个节点</b>
              <p className="subtle">查看时间、进度、风险，并向下拆解任务。</p>
            </div>
          ) : (
            <>
              <button
                className="close-inspector"
                onClick={() => setSelectedId(null)}
                aria-label="收起编辑面板"
                title="收起编辑面板"
              >
                ×
              </button>
              <span className="eyebrow">
                {depth(project, selected) + 1} 级节点 ·{" "}
                {
                  project.categories.find((c) => c.id === selected.categoryId)
                    ?.name
                }
              </span>
              <h2>{selected.title}</h2>
              <div className={`workflow-notice ${computedProgress(project, selected) >= 100 ? "done" : activePath.has(selected.id) ? "active" : "locked"}`}>
                {project.completedAt
                  ? "项目已完成 · 调试状态：可以继续修改任意节点的执行状态和进度。"
                  : computedProgress(project, selected) >= 100
                  ? "✓ 该任务已经完成"
                  : selected.id === activeLeaf?.id
                    ? "当前执行任务：完成后将自动解锁下一任务。"
                    : activePath.has(selected.id)
                      ? "该父级正在执行中，进度由黄色标记的下级任务自动归并。"
                      : project.startedAt
                        ? "该任务尚未解锁，请先完成当前黄色任务。"
                        : "项目尚未开始，请先点击图中的起点。"}
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>节点名称</label>
                  <input
                    value={selected.title}
                    onChange={(e) => updateNode({ title: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>事件分类</label>
                  <select
                    value={selected.categoryId}
                    onChange={(e) => updateNode({ categoryId: e.target.value })}
                  >
                    {project.categories.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>开始时间</label>
                    <input
                      type="date"
                      value={selected.start}
                      onChange={(e) => updateNode({ start: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>完成时间</label>
                    <input
                      type="date"
                      value={selected.end}
                      onChange={(e) => updateNode({ end: e.target.value })}
                    />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>执行状态</label>
                    <select
                      disabled={!project.completedAt && selected.id !== activeLeaf?.id}
                      value={
                        computedProgress(project, selected) >= 100
                          ? "completed"
                          : selected.progress <= 0
                            ? "not-started"
                            : "in-progress"
                      }
                      onChange={(e) => {
                        const status = e.target.value;
                        const current = computedProgress(project, selected);
                        updateSubtreeProgress(
                          status === "completed"
                            ? 100
                            : status === "not-started"
                              ? 0
                              : current > 0 && current < 100
                                ? current
                                : 50,
                        );
                      }}
                    >
                      <option value="not-started">未开始</option>
                      <option value="in-progress">进行中</option>
                      <option value="completed">已完成</option>
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label>自身进度 (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      disabled={!project.completedAt && selected.id !== activeLeaf?.id}
                      value={computedProgress(project, selected)}
                      onChange={(e) => updateSubtreeProgress(Number(e.target.value))}
                    />
                    {(childrenMap.get(selected.id)?.length || 0) > 0 && (
                      <p className="field-help">修改此进度会同步到该节点的全部下级任务，再重新归并。</p>
                    )}
                  </div>
                  <div className="field">
                    <label>归并权重</label>
                    <input
                      type="number"
                      min="1"
                      value={selected.weight}
                      onChange={(e) =>
                        updateNode({
                          weight: Math.max(1, Number(e.target.value)),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="field">
                  <label>人工风险</label>
                  <select
                    value={computedProgress(project, selected) >= 100 ? "green" : selected.risk}
                    disabled={computedProgress(project, selected) >= 100}
                    onChange={(e) =>
                      updateNode({ risk: e.target.value as Risk })
                    }
                  >
                    <option value="green">绿色 · 正常</option>
                    <option value="yellow">黄色 · 需要关注</option>
                    <option value="red">红色 · 已延误/阻塞</option>
                  </select>
                  <p className="field-help">
                    自动延误：完成日期早于今天且状态不是“已完成”时才会标红。设为“已完成”会将进度更新为 100%，并停止延误传递。
                  </p>
                </div>
                {error && <div className="validation">{error}</div>}
              </div>
              <div className="inspector-actions">
                <button className="btn primary" onClick={addChild}>
                  ＋ 添加子节点
                </button>
                <button
                  className="btn"
                  onClick={() => toggle(selected.id)}
                  disabled={!childrenMap.get(selected.id)?.length}
                >
                  {expanded.has(selected.id) ? "收起子节点" : "展开子节点"}
                </button>
              </div>
              <div className="mini-divider" />
              <div className="meta-row">
                <span>物理归并进度</span>
                <strong>{computedProgress(project, selected)}%</strong>
              </div>
              <div className="meta-row">
                <span>下级节点</span>
                <strong>{descendants(project, selected.id).length} 个</strong>
              </div>
              <div className="mini-divider" />
              <DependencyEditor
                project={project}
                selected={selected}
                setProject={setProject}
              />
              <div className="mini-divider" />
              <button
                className="btn"
                style={{
                  color: "#b43e4c",
                  width: "100%",
                  justifyContent: "center",
                }}
                onClick={deleteNode}
              >
                删除节点及其子节点
              </button>
            </>
          )}
        </aside>
      </section>
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreate={(p) => {
            setProject(p);
            window.history.replaceState({}, "", `/?project=${p.id}`);
            setExpanded(new Set());
            setSelectedId(null);
            setAttachmentNodeId(null);
            setShowCreate(false);
          }}
        />
      )}
      {floatingTip && (
        <div className="floating-line-tooltip" style={{ left: floatingTip.x, top: floatingTip.y }}>
          {floatingTip.text}
        </div>
      )}
      {celebrating && (
        <div className="project-celebration" role="status" aria-live="polite">
          <div className="celebration-fireworks" aria-hidden="true">
            {Array.from({ length: 24 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}
          </div>
          <div className="celebration-card">
            <span>🎉</span>
            <strong>恭喜，项目完成！</strong>
            <small>{project.name} 的全部任务均已完成</small>
          </div>
        </div>
      )}
    </main>
  );
}

function DependencyEditor({
  project,
  selected,
  setProject,
}: {
  project: Project;
  selected: PlanNode;
  setProject: (updater: (p: Project) => Project) => void;
}) {
  const blocked = new Set([
    selected.id,
    ...descendants(project, selected.id).map((n) => n.id),
  ]);
  const candidates = project.nodes.filter((n) => !blocked.has(n.id));
  const [from, setFrom] = useState(candidates[0]?.id || "");
  const [type, setType] = useState<DependencyType>("finish-start");
  const incoming = project.dependencies.filter((d) => d.to === selected.id);
  const add = () => {
    if (!from || incoming.some((d) => d.from === from && d.type === type)) return;
    setProject((p) => ({
      ...p,
      dependencies: [...p.dependencies, { from, to: selected.id, type }],
    }));
  };
  return (
    <div>
      <div className="panel-title">前置关系</div>
      {incoming.map((dep, i) => (
        <div className="meta-row" key={`${dep.from}-${i}`}>
          <span>{project.nodes.find((n) => n.id === dep.from)?.title || "未知节点"}</span>
          <span>
            {dep.type === "finish-start" ? "完成后开始" : "可并行"}
            <button
              aria-label="删除依赖"
              onClick={() =>
                setProject((p) => ({
                  ...p,
                  dependencies: p.dependencies.filter((d) => d !== dep),
                }))
              }
              style={{ border: 0, background: "none", color: "#b43e4c" }}
            >
              ×
            </button>
          </span>
        </div>
      ))}
      {!incoming.length && <p className="subtle">尚未设置前置节点，可添加多个。</p>}
      <div className="field" style={{ marginTop: 9 }}>
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          {candidates.map((n) => <option value={n.id} key={n.id}>{n.title}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as DependencyType)}>
          <option value="finish-start">完成后开始</option>
          <option value="parallel">可并行</option>
        </select>
        <button className="btn" onClick={add}>添加前置关系</button>
      </div>
    </div>
  );
}

function CreateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (p: Project) => void;
}) {
  const [name, setName] = useState("新项目计划"),
    [start, setStart] = useState(isoDate(new Date())),
    [end, setEnd] = useState(isoDate(new Date(Date.now() + 180 * DAY))),
    [count, setCount] = useState(7),
    [categories, setCategories] = useState<string[]>([
      "Thinking",
      "Doing",
      "Acting",
    ]),
    [catInput, setCatInput] = useState("");
  const valid =
    parse(end) > parse(start) &&
    count >= 1 &&
    count <= 20 &&
    categories.length > 0;
  const addCategory = () => {
    const v = catInput.trim();
    if (v && !categories.includes(v)) {
      setCategories([...categories, v]);
      setCatInput("");
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <h1>创建一张项目全景图</h1>
          <p>先定义项目边界和骨架；节点的具体时间可以在画布中继续调整。</p>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>项目名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>项目开始</label>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="field">
              <label>项目结束</label>
              <input
                type="date"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>生成几个一级节点（1—20）</label>
            <input
              type="number"
              min="1"
              max="20"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>纵轴事件分类</label>
            <div className="category-editor">
              {categories.map((c) => (
                <span className="category-chip" key={c}>
                  {c}
                  <button
                    onClick={() =>
                      setCategories(categories.filter((x) => x !== c))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={catInput}
                placeholder="输入分类名称"
                onChange={(e) => setCatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCategory();
                  }
                }}
              />
              <button className="btn" onClick={addCategory}>
                添加
              </button>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            返回当前项目
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() =>
              onCreate(demoProject(count, name, start, end, categories))
            }
          >
            生成项目骨架
          </button>
        </div>
      </div>
    </div>
  );
}
