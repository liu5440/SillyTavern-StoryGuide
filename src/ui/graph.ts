import type { Story } from '../domain/story';
import { el, button } from './dom';
const ns = 'http://www.w3.org/2000/svg';

/** 图只消费已过滤的业务数据，不自行推测解锁或改变剧情结构。 */
export function graph(
  story: Story,
  current: string,
  select: (id: string) => void,
  edgeSelect: (id: string) => void,
  moved?: (id: string, x: number, y: number) => void,
): HTMLElement {
  const root = el('section', 'sg-graph');
  const toolbar = el('div', 'sg-toolbar');
  const viewport = el('div', 'sg-graph-viewport');
  const stage = el('div', 'sg-graph-stage');
  const scaleBox = el('div', 'sg-graph-scale');
  scaleBox.append(stage);
  viewport.append(scaleBox);
  let zoom = 1;
  const depths = new Map<string, number>();
  story.nodes.forEach((n) => depths.set(n.id, 0));
  // 节点排序由拓扑深度决定，避免模型输出数组顺序影响分支位置。
  for (let i = 0; i < story.nodes.length; i++) {
    let change = false;
    for (const e of story.edges) {
      const depth = (depths.get(e.from) ?? 0) + 1;
      if (depth > (depths.get(e.to) ?? 0) && depth <= story.nodes.length) {
        depths.set(e.to, depth);
        change = true;
      }
    }
    if (!change) break;
  }
  const rows = new Map<number, number>();
  const points = new Map<string, { x: number; y: number }>();
  for (const n of story.nodes) {
    const depth = depths.get(n.id) ?? 0;
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    points.set(n.id, story.positions[n.id] ?? { x: 35 + depth * 265, y: 45 + row * 150 });
  }
  const width = Math.max(800, ...[...points.values()].map((p) => p.x + 260));
  const height = Math.max(360, ...[...points.values()].map((p) => p.y + 160));
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  const size = () => {
    stage.style.transform = `scale(${zoom})`;
    scaleBox.style.width = `${width * zoom}px`;
    scaleBox.style.height = `${height * zoom}px`;
  };
  size();
  toolbar.append(
    button('缩小', () => {
      zoom = Math.max(0.35, zoom - 0.15);
      size();
    }),
    button('放大', () => {
      zoom = Math.min(1.6, zoom + 0.15);
      size();
    }),
    button('定位当前', () => {
      const p = points.get(current);
      if (p)
        viewport.scrollTo({
          left: Math.max(0, p.x * zoom - 70),
          top: Math.max(0, p.y * zoom - 50),
          behavior: 'smooth',
        });
    }),
    el('span', 'sg-muted', moved ? '拖动节点调整布局 · 点击连线编辑分支' : '点击事件查看详情'),
  );
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.classList.add('sg-lines');
  stage.append(svg);
  const paintLines = () => {
    svg.replaceChildren();
    for (const edge of story.edges) {
      const from = points.get(edge.from),
        to = points.get(edge.to);
      if (!from || !to) continue;
      const x1 = from.x + 205,
        y1 = from.y + 43,
        x2 = to.x,
        y2 = to.y + 43;
      const group = document.createElementNS(ns, 'g');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + 35} ${y1} ${x2 - 35} ${y2} ${x2} ${y2}`);
      path.setAttribute('class', 'sg-line');
      const arrow = document.createElementNS(ns, 'path');
      arrow.setAttribute('d', `M ${x2 - 8} ${y2 - 5} L ${x2} ${y2} L ${x2 - 8} ${y2 + 5}`);
      arrow.setAttribute('class', 'sg-line');
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', String((x1 + x2) / 2));
      text.setAttribute('y', String((y1 + y2) / 2 - 8));
      text.textContent = edge.label.slice(0, 14);
      text.setAttribute('class', 'sg-edge-label');
      group.append(path, arrow, text);
      group.addEventListener('click', () => edgeSelect(edge.id));
      svg.append(group);
    }
  };
  paintLines();
  const labels = { start: '开场', event: '事件', choice: '选择', ending: '结局' };
  for (const node of story.nodes) {
    const card = el(
      'button',
      `sg-graph-node sg-kind-${node.type}${current === node.id ? ' sg-current' : ''}`,
    );
    card.type = 'button';
    card.append(
      el('span', 'sg-node-type', `${labels[node.type]}${current === node.id ? ' · 当前' : ''}`),
      el('strong', '', node.title),
      el('small', '', node.location || node.chapter || '未标地点'),
    );
    const p = points.get(node.id)!;
    card.style.left = `${p.x}px`;
    card.style.top = `${p.y}px`;
    let dragging: { x: number; y: number; left: number; top: number } | undefined;
    let dragged = false;
    card.addEventListener('pointerdown', (e) => {
      dragged = false;
      if (!moved || e.button !== 0) return;
      card.setPointerCapture(e.pointerId);
      dragging = { x: e.clientX, y: e.clientY, left: p.x, top: p.y };
    });
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - dragging.x) / zoom,
        dy = (e.clientY - dragging.y) / zoom;
      if (Math.abs(dx) + Math.abs(dy) < 5) return;
      dragged = true;
      p.x = Math.min(19000, Math.max(0, dragging.left + dx));
      p.y = Math.min(19000, Math.max(0, dragging.top + dy));
      card.style.left = `${p.x}px`;
      card.style.top = `${p.y}px`;
      paintLines();
    });
    card.addEventListener('pointerup', () => {
      if (dragging && dragged) moved?.(node.id, p.x, p.y);
      dragging = undefined;
    });
    card.addEventListener('pointercancel', () => {
      dragging = undefined;
    });
    card.addEventListener('click', () => {
      if (!dragged) select(node.id);
    });
    stage.append(card);
  }
  if (!story.nodes.length)
    viewport.append(el('p', 'sg-empty', '当前没有可见事件。可以查看列表，或主动开启完整攻略。'));
  root.append(toolbar, viewport);
  return root;
}
