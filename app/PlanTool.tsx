"use client";

import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ProjectStatus = "draft" | "running" | "paused" | "completed";
type NodeStatus = "pending" | "active" | "completed";
type LinkKind = "logic" | "relation";
type Tool = "select" | "node" | "logic" | "relation";
type WorkingSection = "principles" | "content" | "acceptance" | "approval" | "result";

type Category = { id: string; name: string; color: string };
type TeamMember = { id: string; name: string; role: string; duty: string; breakdown: string };
type ApprovalStep = { id: string; name: string; opinion: string; status: "pending" | "approved" | "rejected" };
type AttachmentMeta = {
  id: string;
  nodeId: string;
  section: WorkingSection;
  name: string;
  size: number;
  type: string;
  addedAt: string;
};
type Working = {
  principles: string;
  content: string;
  acceptance: string;
  team: TeamMember[];
  approvals: ApprovalStep[];
  resultNote: string;
  resultStatus: "pending" | "approved" | "rejected";
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
  status: NodeStatus;
  working: Working;
};
type PlanLink = { id: string; kind: LinkKind; from: string; to: string };
type Project = {
  version: 2;
  id: string;
  name: string;
  start: string;
  end: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  timelineVisible: boolean;
  categories: Category[];
  nodes: PlanNode[];
  links: PlanLink[];
  attachments: AttachmentMeta[];
};
type Rect = { x: number; y: number; width: number; height: number };
type Positioned = Rect & { node: PlanNode; level: number; number: string };
type Frame = Rect & {
  nodeId: string;
  level: number;
  bands: { categoryId: string; y: number; height: number }[];
  ticks: { x: number; label: string }[];
  axisLabel: string;
};
type DragState = {
  id: string;
  kind: "move" | "start" | "end";
  startX: number;
  startY: number;
  original: PlanNode;
};

const DAY = 86_400_000;
const PROJECTS_KEY = "planthrough-projects-v2";
const CURRENT_KEY = "planthrough-current-v2";
const COLORS = ["#2f73ff", "#25a878", "#8b68e8", "#e59a24", "#df5f72", "#299bb4"];
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const parseDate = (value: string) => new Date(`${value}T00:00:00`).getTime();
const dateString = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const shortDate = (value: string) => value.slice(5).replace("-", "/");
const emptyWorking = (): Working => ({
  principles: "",
  content: "",
  acceptance: "",
  team: [{ id: uid(), name: "", role: "", duty: "", breakdown: "" }],
  approvals: [
    { id: uid(), name: "发起人", opinion: "", status: "pending" },
    { id: uid(), name: "验收人", opinion: "", status: "pending" },
  ],
  resultNote: "",
  resultStatus: "pending",
});
const formatSize = (size: number) =>
  size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

function blankProject(name = "未命名项目", start?: string, end?: string, categoryNames = ["Thinking", "Doing", "Acting"]): Project {
  const now = new Date();
  const s = start || dateString(now.getTime());
  const e = end || dateString(now.getTime() + 180 * DAY);
  const stamp = new Date().toISOString();
  return {
    version: 2,
    id: `project-${uid()}`,
    name,
    start: s,
    end: e,
    createdAt: stamp,
    updatedAt: stamp,
    status: "draft",
    timelineVisible: true,
    categories: categoryNames.map((item, i) => ({ id: `cat-${uid()}`, name: item, color: COLORS[i % COLORS.length] })),
    nodes: [],
    links: [],
    attachments: [],
  };
}

function readProjects(): Project[] {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]") as Project[];
  } catch {
    return [];
  }
}

function saveProject(project: Project) {
  const saved = { ...project, updatedAt: new Date().toISOString() };
  const projects = readProjects();
  const index = projects.findIndex((item) => item.id === saved.id);
  if (index >= 0) projects[index] = saved;
  else projects.unshift(saved);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  localStorage.setItem(CURRENT_KEY, saved.id);
}

function openFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("planthrough-files-v2", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
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

async function readFileBlob(id: string) {
  const db = await openFileDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction("files", "readonly").objectStore("files").get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

async function deleteFileBlob(id: string) {
  const db = await openFileDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(id);
    tx.oncomplete = () => resolve();
  });
  db.close();
}

function childrenOf(project: Project, parentId: string | null) {
  return project.nodes.filter((node) => node.parentId === parentId);
}

function descendants(project: Project, id: string): PlanNode[] {
  const direct = childrenOf(project, id);
  return direct.flatMap((node) => [node, ...descendants(project, node.id)]);
}

function nodeDepth(project: Project, node: PlanNode) {
  let level = 0;
  let parent = node.parentId;
  while (parent) {
    level += 1;
    parent = project.nodes.find((item) => item.id === parent)?.parentId || null;
  }
  return level;
}

function sortedSiblings(project: Project, parentId: string | null) {
  return childrenOf(project, parentId).sort((a, b) => parseDate(a.start) - parseDate(b.start) || parseDate(a.end) - parseDate(b.end) || a.id.localeCompare(b.id));
}

function displayNumber(project: Project, node: PlanNode) {
  const parts: string[] = [];
  let current: PlanNode | undefined = node;
  while (current) {
    const siblings = sortedSiblings(project, current.parentId);
    const index = siblings.findIndex((item) => item.id === current?.id) + 1;
    parts.unshift(`${String.fromCharCode(65 + parts.length)}${index}`);
    current = current.parentId ? project.nodes.find((item) => item.id === current?.parentId) : undefined;
  }
  return parts.map((part, i) => `${String.fromCharCode(65 + i)}${part.replace(/^./, "")}`).join("-");
}

function calculatedProgress(project: Project, node: PlanNode): number {
  const children = childrenOf(project, node.id);
  if (!children.length) return node.progress;
  const total = children.reduce((sum, item) => sum + item.weight, 0) || 1;
  return Math.round(children.reduce((sum, item) => sum + calculatedProgress(project, item) * item.weight, 0) / total);
}

function terminalRoots(project: Project) {
  const roots = childrenOf(project, null);
  const outgoing = new Set(project.links.filter((link) => link.kind === "logic").map((link) => link.from));
  return roots.filter((node) => !outgoing.has(node.id));
}

function allTerminalRootsComplete(project: Project) {
  const terminals = terminalRoots(project);
  return terminals.length > 0 && terminals.every((node) => node.status === "completed");
}

function canEdit(project: Project) {
  return project.status === "draft" || project.status === "paused";
}

function isPendingExecutable(project: Project, node: PlanNode) {
  if (node.status !== "pending" || project.status !== "running") return false;
  const siblings = sortedSiblings(project, node.parentId);
  const incoming = project.links.filter((link) => link.kind === "logic" && link.to === node.id);
  const contextActive = node.parentId
    ? project.nodes.find((item) => item.id === node.parentId)?.status === "active"
    : !siblings.some((item) => item.status === "active");
  if (!contextActive) return false;
  if (incoming.length) {
    return incoming.every((link) => project.nodes.find((item) => item.id === link.from)?.status === "completed");
  }
  const entryCandidates = siblings.filter((item) => {
    const hasIncoming = project.links.some((link) => link.kind === "logic" && link.to === item.id);
    return !hasIncoming && item.status === "pending";
  });
  return entryCandidates[0]?.id === node.id;
}

function nodeTone(project: Project, node: PlanNode): NodeStatus {
  if (node.status === "completed") return "completed";
  if (node.status === "active" || isPendingExecutable(project, node) || descendants(project, node.id).some((item) => item.status === "active" || isPendingExecutable(project, item))) return "active";
  return "pending";
}

function bezier(a: Positioned, b: Positioned) {
  const x1 = a.x + a.width;
  const y1 = a.y + a.height / 2;
  const x2 = b.x;
  const y2 = b.y + b.height / 2;
  const bend = Math.max(60, Math.abs(x2 - x1) * 0.42);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

export default function PlanTool() {
  const [project, setProject] = useState<Project>(() => blankProject());
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [uploadSection, setUploadSection] = useState<WorkingSection>("content");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [toast, setToast] = useState("");
  const [celebrating, setCelebrating] = useState(false);
  const [today] = useState(() => dateString(new Date().getTime()));
  const dragRef = useRef<DragState | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const projects = readProjects();
    const requested = new URLSearchParams(window.location.search).get("project");
    const current = requested || localStorage.getItem(CURRENT_KEY);
    const found = projects.find((item) => item.id === current) || projects[0];
    const timer = window.setTimeout(() => {
      setProject(found || blankProject());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveProject(project);
  }, [project, ready]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selected = project.nodes.find((node) => node.id === selectedId) || null;
  const editable = canEdit(project);
  const totalRange = Math.max(DAY, parseDate(project.end) - parseDate(project.start));
  const spanDays = Math.ceil(totalRange / DAY);
  const canvasWidth = Math.max(1500, Math.round((spanDays < 60 ? 32 : spanDays < 370 ? 8 : 3.2) * spanDays * zoom));
  const rootTop = 112;
  const dateX = (date: string, left = 70, width = canvasWidth - 140, start = project.start, end = project.end) => {
    const range = Math.max(DAY, parseDate(end) - parseDate(start));
    return left + clamp((parseDate(date) - parseDate(start)) / range, 0, 1) * width;
  };

  const layout = useMemo(() => {
    const positions = new Map<string, Positioned>();
    const frames: Frame[] = [];
    const FRAME_HEADER = 42;
    const BAND_HEIGHT = 116;
    const FRAME_AXIS = 40;
    const baseFrameHeight = FRAME_HEADER + project.categories.length * BAND_HEIGHT + FRAME_AXIS;
    const measureFrame = (nodeId: string): number => {
      const nested = sortedSiblings(project, nodeId)
        .filter((child) => expanded.has(child.id) && childrenOf(project, child.id).length)
        .reduce((sum, child) => sum + measureFrame(child.id) + 18, 0);
      return baseFrameHeight + nested;
    };
    let categoryCursor = rootTop;
    const rootNodes = sortedSiblings(project, null);
    const categoryBands = project.categories.map((category) => {
      const nodes = rootNodes.filter((node) => node.categoryId === category.id);
      const requiredHeight = nodes.reduce((height, node, index) => {
        const nodeBottom = 50 + (index % 2) * 70 + 64;
        const expandedBottom = expanded.has(node.id) && childrenOf(project, node.id).length
          ? nodeBottom + 14 + measureFrame(node.id) + 24
          : nodeBottom + 30;
        return Math.max(height, expandedBottom);
      }, 220);
      const band = { categoryId: category.id, y: categoryCursor, height: requiredHeight };
      categoryCursor += requiredHeight;
      return band;
    });
    const makeFrameTicks = (start: string, end: string, x: number, width: number, level: number) => {
      const range = Math.max(DAY, parseDate(end) - parseDate(start));
      const ticks = Array.from({ length: 6 }, (_, index) => {
        const time = parseDate(start) + range * index / 5;
        const date = new Date(time);
        const label = range > 370 * DAY && level === 1
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
          : `${date.getMonth() + 1}/${date.getDate()}`;
        return { x: x + 14 + (width - 28) * index / 5, label };
      });
      return { ticks, axisLabel: level === 1 && range > 370 * DAY ? "局部时间 · 月" : "局部时间 · 日" };
    };
    const placeFrame = (parent: PlanNode, frameX: number, frameY: number, frameWidth: number, level: number) => {
      const frameHeight = measureFrame(parent.id);
      const bands = project.categories.map((cat, index) => ({
        categoryId: cat.id,
        y: frameY + FRAME_HEADER + index * BAND_HEIGHT,
        height: BAND_HEIGHT,
      }));
      const frameAxis = makeFrameTicks(parent.start, parent.end, frameX, frameWidth, level);
      frames.push({ nodeId: parent.id, level, x: frameX, y: frameY, width: frameWidth, height: frameHeight, bands, ...frameAxis });
      const siblings = sortedSiblings(project, parent.id);
      siblings.forEach((node) => {
        const catIndex = Math.max(0, project.categories.findIndex((cat) => cat.id === node.categoryId));
        const band = bands[catIndex];
        const x = dateX(node.start, frameX + 12, frameWidth - 24, parent.start, parent.end);
        const endX = dateX(node.end, frameX + 12, frameWidth - 24, parent.start, parent.end);
        const minWidth = level === 1 ? 170 : 145;
        const width = Math.max(minWidth, endX - x);
        const sameCategoryBefore = siblings.filter((other) => other.categoryId === node.categoryId && parseDate(other.start) < parseDate(node.start)).length;
        const y = band.y + 18 + (sameCategoryBefore % 2) * 46;
        positions.set(node.id, { node, x, y, width, height: 58, level, number: displayNumber(project, node) });
      });
      let nextNestedY = frameY + FRAME_HEADER;
      siblings.forEach((node) => {
        if (!expanded.has(node.id) || !childrenOf(project, node.id).length) return;
        const owner = positions.get(node.id);
        if (!owner) return;
        const nestedWidth = Math.min(frameWidth - 36, Math.max(230, owner.width * 1.25));
        const nestedX = clamp(owner.x, frameX + 18, frameX + frameWidth - nestedWidth - 18);
        const nestedY = Math.max(owner.y + owner.height + 14, nextNestedY);
        placeFrame(node, nestedX, nestedY, nestedWidth, level + 1);
        nextNestedY = nestedY + measureFrame(node.id) + 18;
      });
    };
    const placeRoots = () => {
      const parentId: string | null = null;
      const siblings = sortedSiblings(project, parentId);
      siblings.forEach((node) => {
        const catIndex = Math.max(0, project.categories.findIndex((cat) => cat.id === node.categoryId));
        const categorySiblings = siblings.filter((other) => other.categoryId === node.categoryId);
        const row = Math.max(0, categorySiblings.findIndex((other) => other.id === node.id)) % 2;
        const x = dateX(node.start, 62, canvasWidth - 124, project.start, project.end);
        const endX = dateX(node.end, 62, canvasWidth - 124, project.start, project.end);
        const minWidth = 220;
        const width = Math.max(minWidth, endX - x);
        const height = 64;
        const y = categoryBands[catIndex].y + 50 + row * 70;
        const number = displayNumber(project, node);
        positions.set(node.id, { node, x, y, width, height, level: 0, number });
        if (expanded.has(node.id) && childrenOf(project, node.id).length) {
          const frameWidth = Math.max(520, width);
          const frameX = clamp(x, 58, canvasWidth - frameWidth - 58);
          const frameY = y + height + 14;
          placeFrame(node, frameX, frameY, frameWidth, 1);
        }
      });
    };
    placeRoots();
    const baseContentHeight = Math.max(760, categoryCursor + 120);
    const contentHeight = Math.max(baseContentHeight, ...frames.map((frame) => frame.y + frame.height + 24), ...[...positions.values()].map((item) => item.y + item.height));
    return { positions, frames, categoryBands, contentHeight };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, expanded, canvasWidth]);

  const mainHeight = layout.contentHeight + 70;

  const concurrency = useMemo(() => {
    const lines: { x: number; text: string }[] = [];
    const groups = new Map<string, PlanNode[]>();
    project.nodes.forEach((node) => {
      const key = node.parentId || "root";
      groups.set(key, [...(groups.get(key) || []), node]);
    });
    groups.forEach((nodes) => {
      nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b) => {
        const start = Math.max(parseDate(a.start), parseDate(b.start));
        const end = Math.min(parseDate(a.end), parseDate(b.end));
        if (start < end) {
          const pa = layout.positions.get(a.id);
          const pb = layout.positions.get(b.id);
          if (pa && pb) {
            const ratio = (start - parseDate(project.start)) / totalRange;
            lines.push({ x: 70 + ratio * (canvasWidth - 140), text: `并发：${a.title} 与 ${b.title}\n${dateString(start)} 至 ${dateString(end)}` });
          }
        }
      }));
    });
    return lines;
  }, [project, layout, canvasWidth, totalRange]);

  const ticks = useMemo(() => {
    const result: { x: number; label: string }[] = [];
    const days = Math.ceil(totalRange / DAY);
    const step = days > 730 ? 365 : days > 180 ? 30 : days > 45 ? 7 : 1;
    for (let d = 0; d <= days; d += step) {
      const time = parseDate(project.start) + d * DAY;
      const date = new Date(time);
      const label = step === 365 ? `${date.getFullYear()}年` : step === 30 ? `${date.getFullYear()}年${date.getMonth() + 1}月` : `${date.getMonth() + 1}/${date.getDate()}`;
      result.push({ x: dateX(dateString(time)), label });
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.start, project.end, canvasWidth]);

  const updateNode = (id: string, changes: Partial<PlanNode>) => {
    setProject((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...changes } : node) }));
  };

  const createNodeAt = (x: number, y: number) => {
    if (!editable) return setToast("请先暂停项目，再修改节点");
    let parentId: string | null = null;
    let scopeStart = project.start;
    let scopeEnd = project.end;
    let scopeX = 70;
    let scopeWidth = canvasWidth - 140;
    let categoryId = layout.categoryBands.find((band) => y >= band.y && y < band.y + band.height)?.categoryId || project.categories[0]?.id;
    [...layout.frames].reverse().some((frame) => {
      if (x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height) {
        const parent = project.nodes.find((node) => node.id === frame.nodeId);
        if (!parent) return false;
        parentId = frame.nodeId;
        scopeStart = parent.start;
        scopeEnd = parent.end;
        scopeX = frame.x + 12;
        scopeWidth = frame.width - 24;
        categoryId = frame.bands.find((band) => y >= band.y && y <= band.y + band.height)?.categoryId || project.categories[0].id;
        return true;
      }
      return false;
    });
    const ratio = clamp((x - scopeX) / Math.max(1, scopeWidth), 0, 1);
    const range = parseDate(scopeEnd) - parseDate(scopeStart);
    const start = dateString(parseDate(scopeStart) + ratio * range);
    const duration = Math.max(DAY, Math.min(range / 5, 30 * DAY));
    const end = dateString(Math.min(parseDate(scopeEnd), parseDate(start) + duration));
    const id = `node-${uid()}`;
    const node: PlanNode = { id, parentId, title: "节点名称，点击可修改", categoryId: categoryId || project.categories[0].id, start, end, progress: 0, weight: 1, status: "pending", working: emptyWorking() };
    setProject((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(id);
    setTool("select");
  };

  const canvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== "node" || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    createNodeAt(event.clientX - rect.left + canvasRef.current.scrollLeft, event.clientY - rect.top + canvasRef.current.scrollTop);
  };

  const handleNodeClick = (node: PlanNode) => {
    if (tool === "logic" || tool === "relation") {
      if (!editable) return setToast("请先暂停项目，再修改连接关系");
      if (!linkSource) {
        setLinkSource(node.id);
        return setToast("请选择要连接的目标节点");
      }
      if (linkSource === node.id) return setLinkSource(null);
      const source = project.nodes.find((item) => item.id === linkSource);
      if (!source || source.parentId !== node.parentId) return setToast("只能连接同一父节点下的同级节点");
      if (tool === "logic") {
        const wouldReverse = project.links.some((link) => link.kind === "logic" && link.from === node.id && link.to === source.id);
        if (wouldReverse) return setToast("不能建立相互循环的逻辑线");
      }
      const kind = tool;
      setProject((current) => ({ ...current, links: [...current.links.filter((link) => !(link.kind === kind && link.from === source.id && link.to === node.id)), { id: `link-${uid()}`, kind, from: source.id, to: node.id }] }));
      setLinkSource(null);
      setTool("select");
      return;
    }
    setSelectedId(node.id);
  };

  const startDrag = (event: ReactPointerEvent, node: PlanNode, kind: DragState["kind"]) => {
    if (!editable || tool !== "select") return;
    event.stopPropagation();
    dragRef.current = { id: node.id, kind, startX: event.clientX, startY: event.clientY, original: { ...node } };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent, node: PlanNode) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== node.id) return;
    const parent = node.parentId ? project.nodes.find((item) => item.id === node.parentId) : null;
    const scopeStart = parent?.start || project.start;
    const scopeEnd = parent?.end || project.end;
    const parentFrame = parent ? layout.frames.find((frame) => frame.nodeId === parent.id) : null;
    const scopePixelWidth = parentFrame ? parentFrame.width - 24 : canvasWidth - 140;
    const scopeDays = Math.max(1, (parseDate(scopeEnd) - parseDate(scopeStart)) / DAY);
    const daysDelta = Math.round((event.clientX - drag.startX) / Math.max(2, scopePixelWidth) * scopeDays);
    const originalDuration = parseDate(drag.original.end) - parseDate(drag.original.start);
    let start = parseDate(drag.original.start);
    let end = parseDate(drag.original.end);
    if (drag.kind === "move") {
      start += daysDelta * DAY;
      end = start + originalDuration;
      if (start < parseDate(scopeStart)) { start = parseDate(scopeStart); end = start + originalDuration; }
      if (end > parseDate(scopeEnd)) { end = parseDate(scopeEnd); start = end - originalDuration; }
    } else if (drag.kind === "start") start = clamp(start + daysDelta * DAY, parseDate(scopeStart), end - DAY);
    else end = clamp(end + daysDelta * DAY, start + DAY, parseDate(scopeEnd));
    let categoryId = node.categoryId;
    if (drag.kind === "move" && canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const pointerY = event.clientY - canvasRect.top + canvasRef.current.scrollTop;
      if (parentFrame) {
        const band = parentFrame.bands.find((item) => pointerY >= item.y && pointerY < item.y + item.height);
        categoryId = band?.categoryId || categoryId;
      } else {
        categoryId = layout.categoryBands.find((band) => pointerY >= band.y && pointerY < band.y + band.height)?.categoryId || categoryId;
      }
    }
    updateNode(node.id, { start: dateString(start), end: dateString(end), categoryId });
  };

  const endDrag = () => { dragRef.current = null; };

  const activateEntry = (current: Project, parentId: string | null): Project => {
    const siblings = sortedSiblings(current, parentId);
    const incoming = new Set(current.links.filter((link) => link.kind === "logic" && siblings.some((node) => node.id === link.to)).map((link) => link.to));
    const first = siblings.filter((node) => !incoming.has(node.id)).sort((a, b) => parseDate(a.start) - parseDate(b.start))[0];
    if (!first) return current;
    const nodes = current.nodes.map((node) => node.id === first.id ? { ...node, status: "active" as NodeStatus } : node);
    let next = { ...current, nodes };
    if (childrenOf(next, first.id).length) next = activateEntry(next, first.id);
    return next;
  };

  const resumeEligible = (current: Project): Project => {
    if (current.nodes.some((node) => node.status === "active")) return current;
    const eligible = current.nodes.filter((node) => {
      if (node.status !== "pending") return false;
      const incoming = current.links.filter((link) => link.kind === "logic" && link.to === node.id);
      return incoming.length > 0 && incoming.every((link) => current.nodes.find((item) => item.id === link.from)?.status === "completed");
    });
    let next = { ...current, nodes: current.nodes.map((node) => eligible.some((item) => item.id === node.id) ? { ...node, status: "active" as NodeStatus } : node) };
    eligible.forEach((node) => { if (childrenOf(next, node.id).length) next = activateEntry(next, node.id); });
    return next;
  };

  const toggleProject = () => {
    setProject((current) => {
      if (current.status === "completed") return current;
      if (current.status === "running") return { ...current, status: "paused" };
      if (current.status === "paused") return resumeEligible({ ...current, status: "running" });
      if (!current.nodes.length) { setToast("请先创建至少一个节点"); return current; }
      return activateEntry({ ...current, status: "running" }, null);
    });
  };

  const completeNode = (id: string) => {
    setProject((current) => {
      const target = current.nodes.find((node) => node.id === id);
      if (!target || (target.status !== "active" && !isPendingExecutable(current, target))) return current;
      if (childrenOf(current, id).some((child) => child.status !== "completed")) { setToast("请先完成该节点的全部子节点"); return current; }
      let next: Project = {
        ...current,
        nodes: current.nodes.map((node) => node.id === id ? { ...node, status: "completed", progress: 100, working: { ...node.working, resultStatus: "approved" } } : node),
      };
      const unlockAtLevel = (completed: PlanNode) => {
        const siblingIds = new Set(childrenOf(next, completed.parentId).map((node) => node.id));
        const successors = next.links.filter((link) => link.kind === "logic" && link.from === completed.id && siblingIds.has(link.to));
        const eligible = successors.map((link) => next.nodes.find((node) => node.id === link.to)).filter((node): node is PlanNode => Boolean(node)).filter((node) => {
          const predecessors = next.links.filter((link) => link.kind === "logic" && link.to === node.id).map((link) => next.nodes.find((item) => item.id === link.from));
          return predecessors.length > 0 && predecessors.every((item) => item?.status === "completed");
        });
        if (eligible.length) {
          next = { ...next, nodes: next.nodes.map((node) => eligible.some((item) => item.id === node.id) ? { ...node, status: "active" } : node) };
          eligible.forEach((node) => { if (childrenOf(next, node.id).length) next = activateEntry(next, node.id); });
        }
      };
      unlockAtLevel(target);
      let parentId = target.parentId;
      while (parentId) {
        const parent = next.nodes.find((node) => node.id === parentId);
        if (!parent || childrenOf(next, parent.id).some((child) => child.status !== "completed")) break;
        next = { ...next, nodes: next.nodes.map((node) => node.id === parent.id ? { ...node, status: "completed", progress: 100 } : node) };
        unlockAtLevel(parent);
        parentId = parent.parentId;
      }
      return next;
    });
  };

  const finishProject = () => {
    if (!allTerminalRootsComplete(project)) return setToast("全部末端逻辑节点完成后才能结束项目");
    setProject((current) => ({ ...current, status: "completed" }));
    setCelebrating(true);
    window.setTimeout(() => setCelebrating(false), 3600);
  };

  const deleteSelected = async () => {
    if (!selected || !editable) return;
    const ids = new Set([selected.id, ...descendants(project, selected.id).map((node) => node.id)]);
    if (!window.confirm(`删除“${selected.title}”及其全部子节点？删除后必须由管理者重新建立逻辑线。`)) return;
    const files = project.attachments.filter((file) => ids.has(file.nodeId));
    await Promise.all(files.map((file) => deleteFileBlob(file.id)));
    setProject((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !ids.has(node.id)),
      links: current.links.filter((link) => !ids.has(link.from) && !ids.has(link.to)),
      attachments: current.attachments.filter((file) => !ids.has(file.nodeId)),
    }));
    setSelectedId(null);
    setToast("节点已删除，请重新建立逻辑线");
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selected) return;
    const files = Array.from(event.target.files || []);
    const metas: AttachmentMeta[] = [];
    for (const file of files) {
      const id = `file-${uid()}`;
      await storeFile(id, file);
      metas.push({ id, nodeId: selected.id, section: uploadSection, name: file.name, size: file.size, type: file.type, addedAt: new Date().toISOString() });
    }
    setProject((current) => ({ ...current, attachments: [...current.attachments, ...metas] }));
    event.target.value = "";
    setFilesOpen(true);
  };

  const downloadFile = async (file: AttachmentMeta) => {
    const blob = await readFileBlob(file.id);
    if (!blob) return setToast("本机未找到该文件");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = file.name; a.click();
    URL.revokeObjectURL(url);
  };

  const removeFile = async (file: AttachmentMeta) => {
    await deleteFileBlob(file.id);
    setProject((current) => ({ ...current, attachments: current.attachments.filter((item) => item.id !== file.id) }));
  };

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${project.name}.plan.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importProject = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const value = JSON.parse(String(reader.result)) as Project;
        if (value.version !== 2) throw new Error();
        const imported = { ...value, id: `project-${uid()}`, name: `${value.name}（导入）`, status: "paused" as ProjectStatus };
        setProject(imported); setSelectedId(null); setExpanded(new Set());
      } catch { setToast("文件不是有效的新版 PlanThrough 项目"); }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const nodeFiles = selected ? project.attachments.filter((file) => file.nodeId === selected.id) : [];
  const activePath = project.nodes.filter((node) => nodeTone(project, node) === "active").sort((a, b) => nodeDepth(project, a) - nodeDepth(project, b));

  if (!ready) return <main className="loading">正在打开 PlanThrough…</main>;

  return (
    <main className="plan-app">
      <header className="topbar">
        <button className="brand" onClick={() => setOverviewOpen((value) => !value)} aria-label="打开项目总览">
          <span className="brand-mark">P↘</span><span><b>PlanThrough</b><small>一张图，无限穿透</small></span>
        </button>
        <nav className="canvas-tools" aria-label="画布工具">
          <button className={tool === "node" ? "active" : ""} onClick={() => { setTool("node"); setLinkSource(null); }}>＋ 新建节点</button>
          <button className={tool === "logic" ? "active" : ""} onClick={() => { setTool("logic"); setLinkSource(null); }}>➜ 逻辑线</button>
          <button className={tool === "relation" ? "active" : ""} onClick={() => { setTool("relation"); setLinkSource(null); }}>⇢ 关系线</button>
        </nav>
        <button className="project-title" onClick={() => editable && setCreateOpen(true)}>{project.name}<small>{project.status === "draft" ? "设计中" : project.status === "running" ? "执行中" : project.status === "paused" ? "已暂停" : "已完成"}</small></button>
        <div className="top-actions">
          <a href="/projects" className="btn">项目查看</a>
          <button className="btn" onClick={() => setCreateOpen(true)}>＋ 新项目</button>
          <button className="btn" onClick={() => importRef.current?.click()}>导入</button>
          <button className="btn" onClick={exportProject}>导出</button>
          <button className={`btn ${project.timelineVisible ? "active" : ""}`} onClick={() => setProject((current) => ({ ...current, timelineVisible: !current.timelineVisible }))}>时间线</button>
          <button className="zoom" onClick={() => setZoom((value) => clamp(value - 0.1, 0.6, 2))}>−</button><span>{Math.round(zoom * 100)}%</span><button className="zoom" onClick={() => setZoom((value) => clamp(value + 0.1, 0.6, 2))}>＋</button>
        </div>
        <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={importProject} />
      </header>

      <section className={`workspace ${overviewOpen ? "with-overview" : ""} ${selected ? "with-editor" : ""}`}>
        {overviewOpen
          ? <Overview project={project} activePath={activePath} onClose={() => setOverviewOpen(false)} />
          : <button className="overview-reopen" onClick={() => setOverviewOpen(true)}>项目总览 ›</button>}
        <div className="canvas-scroll" ref={canvasRef} onPointerDown={canvasPointerDown}>
          <div className={`canvas ${tool !== "select" ? "tool-active" : ""}`} style={{ width: canvasWidth, height: mainHeight }}>
            {project.timelineVisible && ticks.map((tick) => <div className="time-grid" key={`${tick.x}-${tick.label}`} style={{ left: tick.x }} />)}
            {project.categories.map((category, index) => (
              <div className="category-lane" key={category.id} style={{ top: layout.categoryBands[index].y, height: layout.categoryBands[index].height }}>
                <span style={{ color: category.color }}><i style={{ background: category.color }} />{category.name}</span>
              </div>
            ))}
            <div className={`start-marker ${project.status === "draft" ? "blinking" : "started"}`} style={{ left: 28, top: 30 }} onClick={(event) => { event.stopPropagation(); toggleProject(); }}>
              <i /> <b>{project.status === "running" ? "暂停" : project.status === "paused" ? "继续" : project.status === "completed" ? "已完成" : "点击启动"}</b>
            </div>
            <div className={`end-marker ${project.status === "completed" ? "finished" : project.status !== "draft" ? "armed" : "blinking"} ${allTerminalRootsComplete(project) ? "ready" : ""}`} style={{ left: canvasWidth - 78, top: 30 }} onClick={(event) => { event.stopPropagation(); finishProject(); }}>
              <i /> <b>{project.status === "completed" ? "已完成" : "终点"}</b>
            </div>
            <div className="start-end-line" style={{ left: 50, width: canvasWidth - 100, top: 47 }} />

            {layout.frames.map((frame) => (
              <div className={`child-frame level-${frame.level}`} key={frame.nodeId} style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}>
                <b>{project.nodes.find((node) => node.id === frame.nodeId)?.title} · 下级任务</b>
                {frame.bands.map((band) => {
                  const category = project.categories.find((cat) => cat.id === band.categoryId)!;
                  return <div className="frame-band" key={band.categoryId} style={{ top: band.y - frame.y, height: band.height }}><span className="frame-category" style={{ color: category.color }}><i style={{ background: category.color }} />{category.name}</span></div>;
                })}
                <div className="frame-timeline"><div>{frame.ticks.map((tick) => <span key={`${tick.x}-${tick.label}`} style={{ left: tick.x - frame.x }}>{tick.label}</span>)}</div><b>{frame.axisLabel}</b></div>
              </div>
            ))}

            <svg className="links" width={canvasWidth} height={mainHeight} aria-hidden="true">
              <defs>
                <marker id="logic-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
                <marker id="relation-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
              </defs>
              {project.links.map((link) => {
                const a = layout.positions.get(link.from), b = layout.positions.get(link.to);
                if (!a || !b) return null;
                return <path key={link.id} className={link.kind} d={bezier(a, b)} markerEnd={`url(#${link.kind}-arrow)`} />;
              })}
            </svg>

            {concurrency.map((line, index) => <div key={`${line.x}-${index}`} className="concurrency-line" style={{ left: line.x }} onPointerEnter={(event) => setTooltip({ x: event.clientX + 14, y: event.clientY + 14, text: line.text })} onPointerMove={(event) => setTooltip({ x: event.clientX + 14, y: event.clientY + 14, text: line.text })} onPointerLeave={() => setTooltip(null)} />)}
            {project.timelineVisible && <div className="today-line" style={{ left: dateX(today) }} onPointerEnter={(event) => setTooltip({ x: event.clientX + 14, y: event.clientY + 14, text: `当前日期：${today}` })} onPointerLeave={() => setTooltip(null)} />}

            {[...layout.positions.values()].map((item) => {
              const tone = nodeTone(project, item.node);
              const progress = calculatedProgress(project, item.node);
              const hasChildren = childrenOf(project, item.node.id).length > 0;
              return (
                <article
                  key={item.node.id}
                  className={`plan-node level-${item.level} ${tone} ${selectedId === item.node.id ? "selected" : ""} ${linkSource === item.node.id ? "link-source" : ""}`}
                  style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
                  onClick={(event) => { event.stopPropagation(); handleNodeClick(item.node); }}
                  onPointerDown={(event) => startDrag(event, item.node, "move")}
                  onPointerMove={(event) => moveDrag(event, item.node)}
                  onPointerUp={endDrag}
                >
                  <div className="node-number">{item.number}</div>
                  <div className="traffic-lights" aria-label={`节点状态：${tone}`}><i className="red" /><i className="yellow" /><i className="green" /></div>
                  <strong title={item.node.title}>{item.node.title}</strong>
                  <button className="working-button" title="打开 Working" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedId(item.node.id); }}>W</button>
                  <button className="expand-button" title={expanded.has(item.node.id) ? "收起" : "向下展开"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setExpanded((current) => { const next = new Set(current); if (next.has(item.node.id)) next.delete(item.node.id); else next.add(item.node.id); return next; }); }}>{expanded.has(item.node.id) ? "△" : "▽"}</button>
                  <div className="node-meta">{shortDate(item.node.start)} → {shortDate(item.node.end)} · {progress}%</div>
                  <div className="progress"><i style={{ width: `${progress}%` }} /></div>
                  {editable && <><span className="resize-handle left" onPointerDown={(event) => startDrag(event, item.node, "start")} /><span className="resize-handle right" onPointerDown={(event) => startDrag(event, item.node, "end")} /></>}
                  {hasChildren && <span className="child-count">{childrenOf(project, item.node.id).length}</span>}
                </article>
              );
            })}

            {project.timelineVisible && <footer className="timeline-axis">
              {ticks.map((tick) => <span key={`${tick.x}-${tick.label}`} style={{ left: tick.x }}>{tick.label}</span>)}
              <b>时间轴 · {spanDays > 730 ? "年" : spanDays > 180 ? "月" : spanDays > 45 ? "周" : "日"}</b>
            </footer>}
            {!project.nodes.length && <div className="empty-canvas"><b>从这里开始设计项目</b><p>点击“新建节点”，再点击起点和终点之间的任意位置。</p><button onClick={(event) => { event.stopPropagation(); setTool("node"); }}>＋ 新建第一个节点</button></div>}
          </div>
        </div>

        {selected && <WorkingPanel
          project={project}
          node={selected}
          editable={editable}
          files={nodeFiles}
          expanded={expanded.has(selected.id)}
          onClose={() => setSelectedId(null)}
          onUpdate={(changes) => updateNode(selected.id, changes)}
          onProjectChange={setProject}
          onComplete={() => completeNode(selected.id)}
          onDelete={deleteSelected}
          onDeleteLink={(id) => setProject((current) => ({ ...current, links: current.links.filter((link) => link.id !== id) }))}
          onUpload={(section) => { setUploadSection(section); uploadRef.current?.click(); }}
          onFiles={() => setFilesOpen(true)}
          onToggleExpanded={() => setExpanded((current) => { const next = new Set(current); if (next.has(selected.id)) next.delete(selected.id); else next.add(selected.id); return next; })}
        />}
      </section>

      <input ref={uploadRef} hidden type="file" multiple onChange={uploadFiles} accept=".doc,.docx,.pdf,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.zip" />
      {filesOpen && selected && <FileDialog files={nodeFiles} node={selected} onClose={() => setFilesOpen(false)} onDownload={downloadFile} onRemove={removeFile} />}
      {createOpen && <ProjectDialog onClose={() => setCreateOpen(false)} onCreate={(value) => { setProject(value); setExpanded(new Set()); setSelectedId(null); setCreateOpen(false); }} />}
      {tooltip && <div className="line-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.text}</div>}
      {toast && <div className="toast">{toast}</div>}
      {celebrating && <div className="celebration"><div>🎉</div><b>恭喜，项目圆满完成！</b><span>每一步认真执行，都汇聚成了最终成果。</span></div>}
    </main>
  );
}

function Overview({ project, activePath, onClose }: { project: Project; activePath: PlanNode[]; onClose: () => void }) {
  const levels = [0, 1, 2].map((level) => project.nodes.filter((node) => nodeDepth(project, node) === level));
  const rate = (nodes: PlanNode[]) => nodes.length ? Math.round(nodes.reduce((sum, node) => sum + calculatedProgress(project, node), 0) / nodes.length) : 0;
  const current = activePath.at(-1);
  const approval = current?.working.approvals.find((step) => step.status === "pending") || current?.working.approvals.at(-1);
  const approvalText = !current ? "暂无" : approval ? `${approval.name} · ${approval.status === "approved" ? "已通过" : approval.status === "rejected" ? "未通过" : "待处理"}` : "未设置";
  return <aside className="overview-panel">
    <header><b>项目工作台</b><button onClick={onClose} title="收起左侧栏">‹</button></header>
    <section><h3>项目总览</h3><dl><div><dt>项目周期</dt><dd>{Math.ceil((parseDate(project.end) - parseDate(project.start)) / DAY)} 天</dd></div>{levels.map((nodes, i) => <div key={i}><dt>{i + 1} 级节点</dt><dd>{nodes.length} 个</dd></div>)}</dl></section>
    <section><h3>项目效率</h3><dl><div><dt>整体节点完成率</dt><dd>{rate(project.nodes)}%</dd></div>{levels.map((nodes, i) => <div key={i}><dt>{i + 1} 级节点完成率</dt><dd>{rate(nodes)}%</dd></div>)}</dl></section>
    <section className="current-path"><h3>当前节点</h3>{[0, 1, 2].map((level) => { const node = activePath.find((item) => nodeDepth(project, item) === level); return <p key={level}><b>{level + 1}级</b><span>{node ? `${displayNumber(project, node)} · ${node.title}` : "—"}</span></p>; })}<p><b>审批</b><span>{approvalText}</span></p></section>
    <section className="canvas-key"><h3>图例</h3><p><i className="node-swatch root" />一级节点</p><p><i className="node-swatch child" />二级节点</p><p><i className="node-swatch grandchild" />三级节点</p><p><i className="line-swatch logic" />逻辑线（执行顺序）</p><p><i className="line-swatch relation" />关系线（仅关联）</p><p><i className="line-swatch parallel" />并发时间线</p><p><i className="line-swatch today" />当前日期线</p><hr /><p><i className="status-dot pending" />未执行</p><p><i className="status-dot active" />当前任务</p><p><i className="status-dot completed" />已完成</p></section>
  </aside>;
}

function WorkingPanel({ project, node, editable, files, expanded, onClose, onUpdate, onProjectChange, onComplete, onDelete, onDeleteLink, onUpload, onFiles, onToggleExpanded }: {
  project: Project; node: PlanNode; editable: boolean; files: AttachmentMeta[]; expanded: boolean; onClose: () => void; onUpdate: (changes: Partial<PlanNode>) => void; onProjectChange: (value: Project | ((current: Project) => Project)) => void; onComplete: () => void; onDelete: () => void; onDeleteLink: (id: string) => void; onUpload: (section: WorkingSection) => void; onFiles: () => void; onToggleExpanded: () => void;
}) {
  const working = node.working;
  const approvals = working.approvals.length >= 2 ? working.approvals : emptyWorking().approvals;
  const effectiveStatus = nodeTone(project, node);
  const updateWorking = (changes: Partial<Working>) => onUpdate({ working: { ...working, ...changes } });
  const parent = node.parentId ? project.nodes.find((item) => item.id === node.parentId) : null;
  const locked = !editable;
  const setTeam = (id: string, changes: Partial<TeamMember>) => updateWorking({ team: working.team.map((member) => member.id === id ? { ...member, ...changes } : member) });
  const setApproval = (id: string, changes: Partial<ApprovalStep>) => updateWorking({ approvals: approvals.map((step) => step.id === id ? { ...step, ...changes } : step) });
  const completionReason = effectiveStatus !== "active"
    ? "项目启动并按逻辑线执行到本节点后，才能点击验收通过。"
    : !working.content.trim()
      ? "请先填写必填的“节点执行内容”，再进行验收。"
      : "";
  return <aside className="working-panel">
    <header><div><small>{displayNumber(project, node)} · Working</small><h2>{node.title}</h2></div><button onClick={onClose}>×</button></header>
    <div className={`working-status ${effectiveStatus}`}><span>{effectiveStatus === "active" ? "当前执行节点" : effectiveStatus === "completed" ? "节点已完成" : "节点尚未执行"}</span><b>{calculatedProgress(project, node)}%</b></div>
    <label>节点名称<input value={node.title} disabled={locked} onChange={(event) => onUpdate({ title: event.target.value })} /></label>
    <div className="form-row"><label>事件分类<select value={node.categoryId} disabled={locked} onChange={(event) => onUpdate({ categoryId: event.target.value })}>{project.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>归并权重<input type="number" min="0.1" step="0.1" disabled={locked} value={node.weight} onChange={(event) => onUpdate({ weight: Number(event.target.value) || 1 })} /></label></div>
    <div className="form-row"><label>开始时间<input type="date" value={node.start} disabled={locked} min={parent?.start || project.start} max={node.end} onChange={(event) => onUpdate({ start: event.target.value })} /></label><label>完成时间<input type="date" value={node.end} disabled={locked} min={node.start} max={parent?.end || project.end} onChange={(event) => onUpdate({ end: event.target.value })} /></label></div>
    <label>自身进度（0–99%，验收通过后自动为 100%）<input type="number" min="0" max="99" disabled={node.status === "completed"} value={node.progress} onChange={(event) => onUpdate({ progress: clamp(Number(event.target.value), 0, 99) })} /></label>

    <WorkingText title="一、节点的执行原则及标准" value={working.principles} disabled={node.status === "completed"} onChange={(value) => updateWorking({ principles: value })} onUpload={() => onUpload("principles")} />
    <WorkingText required title="二、节点的执行内容" value={working.content} disabled={node.status === "completed"} onChange={(value) => updateWorking({ content: value })} onUpload={() => onUpload("content")} />
    <WorkingText title="三、节点的验收标准" value={working.acceptance} disabled={node.status === "completed"} onChange={(value) => updateWorking({ acceptance: value })} onUpload={() => onUpload("acceptance")} />

    <section className="working-section"><h3>四、节点的执行团队</h3>{working.team.map((member) => <div className="team-row" key={member.id}><input placeholder="姓名" value={member.name} onChange={(event) => setTeam(member.id, { name: event.target.value })} /><input placeholder="身份" value={member.role} onChange={(event) => setTeam(member.id, { role: event.target.value })} /><input placeholder="职责" value={member.duty} onChange={(event) => setTeam(member.id, { duty: event.target.value })} /><input placeholder="任务拆解" value={member.breakdown} onChange={(event) => setTeam(member.id, { breakdown: event.target.value })} /></div>)}<button className="text-button" onClick={() => updateWorking({ team: [...working.team, { id: uid(), name: "", role: "", duty: "", breakdown: "" }] })}>＋ 添加成员</button></section>

    <section className="working-section"><h3>六、节点的审批流及成果提交 <em>*</em></h3>{approvals.map((step, index) => { const isFirst = index === 0; const isLast = index === approvals.length - 1; const fixedName = isFirst ? "发起人" : isLast ? "验收人" : step.name; return <div className="approval-step" key={step.id}><b>步骤 {index + 1}</b><input value={fixedName} disabled={isFirst || isLast} onChange={(event) => setApproval(step.id, { name: event.target.value })} /><select value={step.status} onChange={(event) => setApproval(step.id, { status: event.target.value as ApprovalStep["status"] })}><option value="pending">待处理</option><option value="approved">通过</option><option value="rejected">不通过</option></select><textarea placeholder="审批意见" value={step.opinion} onChange={(event) => setApproval(step.id, { opinion: event.target.value })} /></div>; })}<button className="text-button" onClick={() => { const last = approvals[approvals.length - 1]; const middle = approvals.slice(0, -1); updateWorking({ approvals: [...middle, { id: uid(), name: `审批人 ${middle.length}`, opinion: "", status: "pending" }, { ...last, name: "验收人" }] }); }}>＋ 添加中间审批步骤</button><button className="text-button" onClick={() => onUpload("approval")}>上传审批附件</button><button className="text-button" onClick={onFiles}>查看全部附件（{files.length}）</button></section>

    <section className="working-section"><h3>七、节点的执行结果 <em>*</em></h3><textarea placeholder="填写成果说明、未通过原因或修改建议" value={working.resultNote} onChange={(event) => updateWorking({ resultNote: event.target.value })} /><div className="result-actions"><button className="reject" disabled={effectiveStatus !== "active"} onClick={() => updateWorking({ resultStatus: "rejected" })}>不通过</button><button className="approve" disabled={Boolean(completionReason)} onClick={onComplete}>验收通过并进入下一节点</button></div>{completionReason && <small className="approval-help">{completionReason}</small>}</section>

    <section className="working-section"><h3>八、节点连接关系</h3><div className="link-list">{project.links.filter((link) => link.from === node.id || link.to === node.id).map((link) => { const otherId = link.from === node.id ? link.to : link.from; const other = project.nodes.find((item) => item.id === otherId); return <div key={link.id}><span>{link.kind === "logic" ? "逻辑线" : "关系线"} · {link.from === node.id ? "指向" : "来自"} {other?.title || "未知节点"}</span><button disabled={!editable} onClick={() => onDeleteLink(link.id)}>删除</button></div>; })}{!project.links.some((link) => link.from === node.id || link.to === node.id) && <p className="muted">尚未建立连接。请使用画布顶部的逻辑线或关系线工具。</p>}</div></section>

    <section className="panel-actions"><button onClick={() => { onProjectChange((current) => ({ ...current, nodes: [...current.nodes, { id: `node-${uid()}`, parentId: node.id, title: "节点名称，点击可修改", categoryId: current.categories[0].id, start: node.start, end: node.end, progress: 0, weight: 1, status: "pending", working: emptyWorking() }] })); }}>＋ 添加子节点</button><button disabled={!childrenOf(project, node.id).length} onClick={onToggleExpanded}>{expanded ? "收起子节点" : "展开子节点"}</button><button className="danger" disabled={!editable} onClick={onDelete}>删除本节点</button></section>
  </aside>;
}

function WorkingText({ title, value, disabled, required, onChange, onUpload }: { title: string; value: string; disabled?: boolean; required?: boolean; onChange: (value: string) => void; onUpload: () => void }) {
  return <section className="working-section"><h3>{title} {required && <em>*</em>}</h3><textarea disabled={disabled} placeholder="点击输入" value={value} onChange={(event) => onChange(event.target.value)} /><button className="text-button" onClick={onUpload}>上传附件（doc、PDF、PPT、Excel 等）</button></section>;
}

function FileDialog({ files, node, onClose, onDownload, onRemove }: { files: AttachmentMeta[]; node: PlanNode; onClose: () => void; onDownload: (file: AttachmentMeta) => void; onRemove: (file: AttachmentMeta) => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal files-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><small>节点附件</small><h2>{node.title}</h2></div><button onClick={onClose}>×</button></header><p>共 {files.length} 个文件</p><div className="file-list">{files.map((file) => <article key={file.id}><span>📎</span><div><b>{file.name}</b><small>{formatSize(file.size)} · {file.section}</small></div><button onClick={() => onDownload(file)}>下载</button><button className="danger" onClick={() => onRemove(file)}>删除</button></article>)}{!files.length && <div className="empty-files">这个节点还没有上传文件</div>}</div></div></div>;
}

function ProjectDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (project: Project) => void }) {
  const [name, setName] = useState("新项目计划");
  const [start, setStart] = useState(() => dateString(new Date().getTime()));
  const [end, setEnd] = useState(() => dateString(new Date().getTime() + 180 * DAY));
  const [categories, setCategories] = useState(["Thinking", "Doing", "Acting"]);
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal project-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><small>NEW PROJECT</small><h2>创建一张干净的项目画布</h2></div><button onClick={onClose}>×</button></header><label>项目名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><div className="form-row"><label>项目开始<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>项目结束<input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label></div><label>事件分类</label>{categories.map((category, index) => <div className="category-edit" key={index}><i style={{ background: COLORS[index % COLORS.length] }} /><input value={category} onChange={(event) => setCategories((items) => items.map((item, i) => i === index ? event.target.value : item))} /><button disabled={categories.length <= 1} onClick={() => setCategories((items) => items.filter((_, i) => i !== index))}>删除</button></div>)}<button className="text-button" onClick={() => setCategories((items) => [...items, `分类 ${items.length + 1}`])}>＋ 添加分类</button><footer><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={!name.trim() || parseDate(end) <= parseDate(start)} onClick={() => onCreate(blankProject(name.trim(), start, end, categories.filter(Boolean)))}>创建空白项目</button></footer><small className="migration-note">新版使用独立数据空间，旧测试数据不会进入新项目。</small></div></div>;
}
