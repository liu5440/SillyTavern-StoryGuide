import type { GuideController } from '../application/controller';
import type { ContextSnapshot } from '../host/tavern';
import type { Story } from '../domain/story';
import {
  formalRoute,
  parseLibrary,
  type StoryLibrary,
  type StoryEvent,
  type StoryEdge,
  type StoryMaterial,
} from '../domain/library';
import * as actions from '../application/library';
import { updateRoute, deleteRoute, duplicateRoute } from '../application/routes';
import { classifyMaterials } from '../application/material-classification';
import { groupMaterials } from '../domain/material-groups';
import { LibraryRepository } from '../storage/library-repository';
import { el, button, check, field, download } from './dom';
import { graph } from './graph';
import { openRouteWorkshop } from './route-workshop';

const origins = {
  worldbook_explicit: '原作明确',
  ai_inferred: 'AI 推断',
  ai_generated: 'AI 创作',
  user_manual: '人工编辑',
};
const categories = {
  character: '人物',
  location: '地点',
  world: '世界背景',
  plot: '剧情素材',
  rule: '游戏规则',
  unclassified: '待分类',
};
const kinds = {
  opening: '开场',
  event: '普通事件',
  key_event: '关键事件',
  choice: '玩家选择',
  route_entry: '个人线入口',
  ending: '结局',
};
const relations = {
  precedes: '时间先于',
  continues: '剧情衔接',
  requires: '前置依赖',
  choice: '玩家选择',
  ending_branch: '结局分支',
};
function select(label: string, options: [string, string][], value = '') {
  const root = el('label', 'sg-field');
  root.append(el('span', '', label));
  const input = el('select');
  input.setAttribute('aria-label', label);
  for (const [key, text] of options) {
    const option = el('option', '', text);
    option.value = key;
    input.append(option);
  }
  input.value = value || options[0]?.[0] || '';
  root.append(input);
  return { root, input };
}

/** 工作台仅编排用例和表单；来源、图校验和存档由领域及存储层负责。 */
let openingWorkspace = false;
export async function openWorkspace(
  app: GuideController,
  snapshot: ContextSnapshot,
  story?: Story,
  checkView?: () => void,
) {
  const existing = document.querySelector<HTMLDialogElement>('.sg-workspace');
  if (existing) {
    if (existing.dataset.character !== snapshot.characterKey || existing.dataset.chat !== snapshot.chatKey)
      throw new Error('另一个角色或聊天的工作台仍打开，请先导出或关闭旧工作台再打开当前角色');
    existing.hidden = false;
    existing.focus();
    return;
  }
  if (openingWorkspace) return;
  openingWorkspace = true;
  try {
    const repo = new LibraryRepository();
    let library = await repo.load(snapshot.user, snapshot.characterKey);
    app.guard(snapshot);
    checkView?.();
    if (!library)
      library = actions.importSources(
        actions.createLibrary(snapshot.characterKey, `${snapshot.characterName} · 剧情资料库`),
        snapshot.originalSources ?? snapshot.sources,
        snapshot.readIssues,
      );
    if (!library.routes.length) library = actions.createRoute(library, '公共线', 'common');
    new Workspace(app, snapshot, repo, library, story).open();
  } finally {
    openingWorkspace = false;
  }
}
class Workspace {
  private dialog = el('dialog', 'sg-workspace');
  private status = el('p', 'sg-status', '尚未保存；资料导入不会自动创建剧情事件或连线');
  private columns = el('div', 'sg-workspace-columns');
  private left = el('aside', 'sg-workspace-library');
  private center = el('main', 'sg-workspace-route');
  private right = el('aside', 'sg-workspace-detail');
  private dirty = false;
  private formDirty = false;
  private saving = false;
  private routeId = '';
  private tab = 'route';
  private query = '';
  private materialSelection = new Set<string>();
  private materialCategory = 'unclassified';
  private preview = false;
  private selected?: { type: 'event' | 'edge' | 'material'; id: string };
  private unsubscribe = () => {};
  private previous = document.activeElement;
  private bubble = button('恢复剧情工作台', () => {
    this.dialog.hidden = false;
    this.bubble.hidden = true;
  });
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.dirty || this.formDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  constructor(
    private app: GuideController,
    private snapshot: ContextSnapshot,
    private repo: LibraryRepository,
    private library: StoryLibrary,
    private story?: Story,
  ) {
    this.routeId = library.routes[0]?.id ?? '';
    this.dirty = library.baseRevision !== library.revision;
    this.preview = !this.dirty;
    this.status.textContent = this.dirty
      ? '尚未保存；资料导入不会自动创建剧情事件或连线'
      : '已保存到当前浏览器';
  }
  open() {
    this.dialog.setAttribute('aria-label', '剧情工作台');
    this.dialog.dataset.character = this.snapshot.characterKey;
    this.dialog.dataset.chat = this.snapshot.chatKey;
    const header = el('header', 'sg-workspace-header');
    header.append(
      el('h2', '', '剧情工作台'),
      button('AI 剧情工坊', () =>
        this.safe(() => {
          if (!this.discardForm()) return;
          openRouteWorkshop(
            this.app,
            this.snapshot,
            () => this.library,
            (next) => this.change(next),
          );
        }),
      ),
      button('保存工作台', () => this.safe(() => this.save()), 'sg-primary'),
      button('导出 JSON', () => download('剧情资料库.json', this.library)),
      button('导入 JSON', () => this.importFile()),
      button('重导入当前资料', () => this.reimport()),
      button('恢复上次保存', () =>
        this.safe(async () => {
          if (!confirm('恢复前一个保存版本？建议先导出当前编辑。')) return;
          if (!this.discardForm()) return;
          this.library = await this.repo.restore(this.snapshot.user, this.snapshot.characterKey, () =>
            this.app.guard(this.snapshot),
          );
          this.routeId = this.library.routes[0]?.id ?? '';
          this.dirty = false;
          this.selected = undefined;
          this.render();
          this.status.textContent = '已恢复上次保存版本';
        }),
      ),
      button('返回阅读', () => this.close()),
      button('收起工作台', () => {
        this.dialog.hidden = true;
        this.bubble.hidden = false;
      }),
    );
    if (this.story)
      header.append(
        button('从当前故事建立副本', () =>
          this.safe(async () => {
            if (!confirm('保留旧故事，替换当前工作台为迁移副本？请先保存或导出当前编辑。')) return;
            if (!this.discardForm()) return;
            this.app.guard(this.snapshot);
            const next = actions.migrateStory(this.story as Story);
            this.change({
              ...next,
              id: this.library.id,
              baseRevision: this.library.baseRevision,
              revision: this.library.revision + 1,
            });
            this.routeId = this.library.routes[0]?.id ?? '';
            this.dirty = true;
            this.render();
            this.status.textContent = '迁移副本已载入草稿，旧故事不变；请审阅并保存';
          }),
        ),
      );
    const nav = el('nav', 'sg-workspace-tabs');
    for (const [key, label] of [
      ['library', '资料'],
      ['route', '路线'],
      ['detail', '详情'],
    ] as const) {
      const tab = button(label, () => {
        this.tab = key;
        this.applyTab();
      });
      tab.dataset.workspaceTab = key;
      nav.append(tab);
    }
    this.columns.append(this.left, this.center, this.right);
    this.right.addEventListener('input', () => {
      this.formDirty = true;
      this.status.textContent = '详情表单尚未应用，请先点击应用再保存';
    });
    this.right.addEventListener('change', () => {
      this.formDirty = true;
      this.status.textContent = '详情表单尚未应用，请先点击应用再保存';
    });
    this.dialog.append(header, this.status, nav, this.columns);
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.close();
    });
    this.dialog.addEventListener(
      'close',
      () => {
        document.querySelector<HTMLDialogElement>('.sg-route-workshop')?.close();
        this.unsubscribe();
        window.removeEventListener('beforeunload', this.beforeUnload);
        this.bubble.remove();
        this.dialog.remove();
        if (this.previous instanceof HTMLElement && this.previous.isConnected) this.previous.focus();
      },
      { once: true },
    );
    this.unsubscribe = this.app.host.subscribe(
      () => {
        if (!this.app.host.isCurrent(this.snapshot)) {
          this.status.textContent = '角色或聊天已切换：当前编辑已冻结，可导出备份；请返回阅读后重新打开。';
          this.columns
            .querySelectorAll<
              HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement
            >('input,button,select,textarea')
            .forEach((x) => (x.disabled = true));
        }
      },
      () => {},
    );
    this.bubble.classList.add('sg-guide-bubble');
    this.bubble.hidden = true;
    document.body.append(this.dialog, this.bubble);
    window.addEventListener('beforeunload', this.beforeUnload);
    this.dialog.show();
    this.render();
  }
  private close() {
    if (this.saving) return;
    if ((!this.dirty && !this.formDirty) || confirm('工作台有未保存编辑，返回后将丢失。继续？'))
      this.dialog.close();
  }
  private applyTab() {
    this.dialog.dataset.tab = this.tab;
    for (const tab of this.dialog.querySelectorAll<HTMLButtonElement>('[data-workspace-tab]'))
      tab.setAttribute('aria-pressed', String(tab.dataset.workspaceTab === this.tab));
  }
  private async safe(fn: () => void | Promise<void>) {
    try {
      this.app.guard(this.snapshot);
      if (this.saving) throw new Error('正在保存，请稍后操作');
      await fn();
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : String(error);
    }
  }
  private discardForm() {
    if (this.formDirty && !confirm('详情表单尚未应用，放弃这些输入？')) return false;
    this.formDirty = false;
    return true;
  }
  private change(next: StoryLibrary, formApplied = false) {
    this.app.guard(this.snapshot);
    if (this.saving) throw new Error('正在保存，请稍后编辑');
    if (formApplied) this.formDirty = false;
    else if (!this.discardForm()) return;
    this.library = parseLibrary(next);
    this.dirty = true;
    this.status.textContent = '有未保存编辑';
    this.render();
  }
  private async save() {
    if (this.saving) return;
    if (this.formDirty)
      throw new Error('详情表单尚未应用，请先点击应用事件、应用连接或应用资料分类，再保存工作台');
    if (!this.dirty) {
      this.status.textContent = '已保存到当前浏览器';
      return;
    }
    this.saving = true;
    this.status.textContent = '保存中…';
    const inputs = [
      ...this.columns.querySelectorAll<
        HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement
      >('input,button,select,textarea'),
    ];
    inputs.forEach((input) => (input.disabled = true));
    try {
      this.library = await this.repo.save(this.snapshot.user, this.library, () =>
        this.app.guard(this.snapshot),
      );
      this.dirty = false;
      this.status.textContent = '已保存到当前浏览器';
    } finally {
      this.saving = false;
      if (this.app.host.isCurrent(this.snapshot)) inputs.forEach((input) => (input.disabled = false));
    }
  }
  private render() {
    this.renderLibrary();
    this.renderRoute();
    this.renderDetail();
    this.applyTab();
  }
  private pick(type: 'event' | 'edge' | 'material', id: string) {
    if (!this.discardForm()) return;
    this.selected = { type, id };
    this.tab = 'detail';
    this.render();
  }
  private renderLibrary() {
    this.left.replaceChildren(el('h3', '', '剧情资料库'));
    const search = field('搜索资料和事件', this.query);
    search.input.addEventListener('input', () => {
      this.query = search.input.value;
      this.materialSelection.clear();
      this.renderLibrary();
      const input = this.left.querySelector<HTMLInputElement>('input');
      input?.focus();
      input?.setSelectionRange(this.query.length, this.query.length);
    });
    this.left.append(search.root);
    this.left.append(
      button('新建事件', () => {
        if (!this.discardForm()) return;
        this.selected = undefined;
        this.tab = 'detail';
        this.eventForm();
        this.applyTab();
      }),
    );
    const groups = groupMaterials(this.library).filter((group) =>
      group.members.some((material) => `${material.title} ${material.summary}`.includes(this.query)),
    );
    const visibleIds = groups.flatMap((group) => group.members.map((material) => material.id));
    const selectionCount = el('p', 'sg-muted');
    const refreshCount = () => {
      selectionCount.textContent = `已选择 ${this.materialSelection.size} 条原始资料；同文组包含全部出处`;
    };
    refreshCount();
    const categoryPicker = select('批量资料分类', Object.entries(categories), this.materialCategory);
    categoryPicker.input.addEventListener('change', () => {
      this.materialCategory = categoryPicker.input.value;
    });
    this.left.append(
      el('p', 'sg-material-group-count', `${visibleIds.length} 条原始资料，显示为 ${groups.length} 组`),
      selectionCount,
      button('全选当前结果', () => {
        visibleIds.forEach((id) => this.materialSelection.add(id));
        this.renderLibrary();
      }),
      button('取消资料选择', () => {
        this.materialSelection.clear();
        this.renderLibrary();
      }),
      categoryPicker.root,
      button('应用批量分类', () =>
        this.safe(() => {
          if (!this.discardForm()) return;
          const count = this.materialSelection.size;
          const next = classifyMaterials(
            this.library,
            [...this.materialSelection],
            categoryPicker.input.value,
          );
          this.materialSelection.clear();
          this.change(next);
          this.status.textContent = `已分类 ${count} 条资料；请保存工作台`;
        }),
      ),
    );
    for (const [category, label] of Object.entries(categories)) {
      const matching = groups.filter((group) =>
        group.material.categories.includes(category as keyof typeof categories),
      );
      const group = el('details');
      group.open = true;
      group.append(el('summary', '', label));
      for (const row of matching) {
        const material = row.material;
        const item = el('div', 'sg-material-group');
        const mark = check(
          `选择资料：${material.title}`,
          row.members.every((m) => this.materialSelection.has(m.id)),
          (checked) => {
            for (const member of row.members) {
              if (checked) this.materialSelection.add(member.id);
              else this.materialSelection.delete(member.id);
            }
            refreshCount();
          },
        );
        const title =
          row.members.length > 1 ? `${material.title} · 同文 ${row.members.length} 处` : material.title;
        item.append(
          mark.root,
          button(title, () => this.pick('material', material.id), 'sg-workspace-item'),
        );
        if (row.members.length > 1) {
          const sources = el('details');
          sources.append(el('summary', '', `全部出处（${row.members.length}）`));
          for (const member of row.members)
            sources.append(button(member.title, () => this.pick('material', member.id), 'sg-workspace-item'));
          item.append(sources);
        }
        group.append(item);
      }
      this.left.append(group);
    }
    this.left.append(el('h3', '', '剧情事件池'));
    if (!this.library.events.length) this.left.append(el('p', '', '尚无剧情事件'));
    for (const event of this.library.events.filter((x) => `${x.title} ${x.summary}`.includes(this.query))) {
      const item = el('div', 'sg-workspace-event');
      item.draggable = true;
      item.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/story-event', event.id));
      item.append(
        button(`${event.title} · ${event.status === 'confirmed' ? '已确认' : '待确认'}`, () =>
          this.pick('event', event.id),
        ),
        button('加入路线', () =>
          this.safe(() => this.change(actions.addEventToRoute(this.library, this.routeId, event.id))),
        ),
      );
      this.left.append(item);
    }
    const issues = el('details');
    issues.append(
      el('summary', '', `待整理与导入报告（${this.library.reports.at(-1)?.issues.length ?? 0}）`),
    );
    for (const report of this.library.reports.slice(-1))
      for (const issue of report.issues) issues.append(el('p', '', `${issue.stage} · ${issue.message}`));
    for (const event of this.library.events.filter((x) => x.status !== 'confirmed'))
      issues.append(button(`待确认事件：${event.title}`, () => this.pick('event', event.id)));
    for (const edge of this.library.edges.filter((x) => x.status !== 'confirmed'))
      issues.append(button(`待确认关系：${edge.choiceText || edge.id}`, () => this.pick('edge', edge.id)));
    this.left.append(issues);
  }
  private renderRoute() {
    this.dialog.classList.toggle('sg-workspace-reading-mode', this.preview);
    this.center.replaceChildren(el('h3', '', '剧情路线'));
    const choose = select(
      '当前路线',
      this.library.routes.map((x) => [x.id, x.title]),
      this.routeId,
    );
    choose.input.addEventListener('change', () => {
      if (!this.discardForm()) {
        choose.input.value = this.routeId;
        return;
      }
      this.routeId = choose.input.value;
      this.renderRoute();
    });
    this.center.append(
      choose.root,
      button('新建路线', () => {
        if (!this.discardForm()) return;
        const title = prompt('路线名称');
        if (title)
          this.safe(() => {
            const next = actions.createRoute(this.library, title, 'custom');
            this.routeId = next.routes.at(-1)?.id ?? '';
            this.change(next);
          });
      }),
      button('管理当前路线', () => {
        if (!this.discardForm()) return;
        this.tab = 'detail';
        this.routeForm();
        this.applyTab();
      }),
      button(this.preview ? '返回编辑草稿' : '正式阅读（仅已确认）', () => {
        this.preview = !this.preview;
        this.renderRoute();
      }),
      button('建立连接', () => {
        if (!this.discardForm()) return;
        this.tab = 'detail';
        this.edgeForm();
        this.applyTab();
      }),
    );
    const route = this.library.routes.find((x) => x.id === this.routeId);
    if (!route) return;
    const routeKinds = { common: '公共路线', character: '人物个人线', custom: '自定义路线' };
    this.center.append(
      el(
        'p',
        'sg-muted',
        `${routeKinds[route.kind]}${route.characters.length ? ` · ${route.characters.join('、')}` : ''} · ${route.completeness === 'playable' ? '完整路线' : '路线片段'}`,
      ),
    );
    const projection = this.preview
      ? formalRoute(this.library, route.id)
      : {
          route,
          events: this.library.events.filter((x) => route.eventIds.includes(x.id)),
          edges: this.library.edges.filter((x) => route.edgeIds.includes(x.id)),
        };
    this.center.append(
      el(
        'p',
        'sg-muted',
        this.preview
          ? '正式阅读 · 未确认事件及关系已排除'
          : '编辑草稿 · 人物背景不会成为图节点，加入事件不会自动连线',
      ),
    );
    const old: Story = {
      schemaVersion: 1,
      id: this.library.id,
      revision: 1,
      characterKey: this.library.characterKey,
      title: route.title,
      summary: '',
      mode: 'create',
      status: 'draft',
      createdAt: '',
      sources: [],
      positions: route.positions,
      nodes: projection.events.map((e) => ({
        id: e.id,
        type:
          e.kind === 'choice'
            ? 'choice'
            : e.kind === 'ending'
              ? 'ending'
              : e.kind === 'opening'
                ? 'start'
                : 'event',
        title: e.title,
        summary: e.summary,
        characters: e.characters,
        location: e.location,
        time: e.time,
        chapter: '',
        provenance: 'user',
        refs: [],
        spoiler: false,
        locked: e.locked,
      })),
      edges: projection.edges.map((e) => ({
        id: e.id,
        from: e.sourceNodeId,
        to: e.targetNodeId,
        label: e.choiceText || relations[e.relationType],
        condition: e.condition,
        provenance: 'user',
        refs: [],
      })),
    };
    const canvas = graph(
      old,
      '',
      (id) => this.pick('event', id),
      (id) => this.pick('edge', id),
      this.preview
        ? undefined
        : (id, x, y) =>
            this.safe(() => this.change(actions.setRoutePosition(this.library, route.id, id, { x, y }))),
    );
    canvas.querySelectorAll<HTMLElement>('.sg-graph-node').forEach((card, index) => {
      const event = projection.events[index];
      if (!event) return;
      card.append(
        el(
          'small',
          'sg-workspace-origin',
          `${origins[event.origin]} · ${event.status === 'confirmed' ? '已确认' : '待确认'}`,
        ),
      );
      if (this.preview) return;
      const port = el('span', 'sg-workspace-port', '拖出连接');
      port.draggable = true;
      port.addEventListener('pointerdown', (e) => e.stopPropagation());
      port.addEventListener('click', (e) => e.stopPropagation());
      port.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer?.setData('text/story-edge', event.id);
      });
      card.addEventListener('dragover', (e) => e.preventDefault());
      card.addEventListener('drop', (e) => {
        const from = e.dataTransfer?.getData('text/story-edge');
        if (!from) return;
        e.stopPropagation();
        e.preventDefault();
        if (!this.discardForm()) return;
        this.tab = 'detail';
        this.edgeForm(undefined, from, event.id);
        this.applyTab();
      });
      card.append(port);
    });
    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = e.dataTransfer?.getData('text/story-event');
      if (id && !this.preview)
        this.safe(() => this.change(actions.addEventToRoute(this.library, route.id, id)));
    });
    this.center.append(canvas);
    if (!this.preview)
      this.center.append(
        button('自动布局', () =>
          this.safe(() => {
            let next = this.library;
            route.eventIds.forEach((id, index) => {
              next = actions.setRoutePosition(next, route.id, id, {
                x: 35 + (index % 3) * 265,
                y: 45 + Math.floor(index / 3) * 150,
              });
            });
            this.change(next);
          }),
        ),
      );
    this.center.append(el('h3', '', '纵向分支列表'));
    if (!projection.events.length)
      this.center.append(el('p', '', '当前路线暂无可展示事件；从事件池加入，不会自动创建连接。'));
    for (const event of projection.events) {
      const card = el('section', 'sg-workspace-reading');
      card.append(
        button(`${kinds[event.kind]} · ${event.title}`, () => this.pick('event', event.id)),
        el('p', '', event.summary),
        el('small', '', `${origins[event.origin]} · ${event.status}`),
      );
      for (const edge of projection.edges.filter((x) => x.sourceNodeId === event.id)) {
        const target = projection.events.find((x) => x.id === edge.targetNodeId);
        card.append(
          button(`${edge.choiceText || relations[edge.relationType]} → ${target?.title ?? ''}`, () =>
            this.pick('edge', edge.id),
          ),
          el('p', '', edge.condition),
        );
      }
      if (!projection.edges.some((x) => x.sourceNodeId === event.id || x.targetNodeId === event.id))
        card.append(el('span', 'sg-muted', '未连接事件'));
      this.center.append(card);
    }
  }
  private renderDetail() {
    this.right.replaceChildren(el('h3', '', '详情编辑'));
    if (!this.selected) {
      this.right.append(el('p', '', '选择资料、事件或连线查看详情。'));
      return;
    }
    if (this.selected.type === 'material') {
      const material = this.library.materials.find((x) => x.id === this.selected?.id);
      if (material) this.materialDetail(material);
    } else if (this.selected.type === 'event') {
      const event = this.library.events.find((x) => x.id === this.selected?.id);
      if (event) this.eventForm(event);
    } else {
      const edge = this.library.edges.find((x) => x.id === this.selected?.id);
      if (edge) this.edgeForm(edge);
    }
  }
  private evidence(item: StoryEvent | StoryEdge | StoryMaterial) {
    this.right.append(el('p', 'sg-muted', `${origins[item.origin]} · ${item.status}`));
    for (const evidence of item.evidence) {
      const source = this.library.sources.find((x) => x.id === evidence.sourceSnapshotId);
      const detail = el('details');
      detail.append(
        el(
          'summary',
          '',
          `${source?.label ?? '未知来源'} · ${evidence.role === 'direct_support' ? '直接依据' : '创作参考'}`,
        ),
        el('pre', 'sg-workspace-text', evidence.quote),
      );
      this.right.append(detail);
    }
  }
  private materialDetail(material: StoryMaterial) {
    const title = field('资料名称', material.title);
    const summary = field('资料归纳', material.summary, true);
    const category = select('资料分类', Object.entries(categories), material.categories[0]);
    this.right.append(
      title.root,
      summary.root,
      category.root,
      button('应用资料分类', () =>
        this.safe(() => {
          this.change(
            actions.updateMaterial(this.library, material.id, {
              title: title.input.value,
              summary: summary.input.value,
              categories: [category.input.value as keyof typeof categories],
            }),
            true,
          );
        }),
      ),
    );
    for (const id of material.sourceSnapshotIds) {
      const source = this.library.sources.find((x) => x.id === id);
      if (source) {
        const detail = el('details');
        detail.append(
          el('summary', '', `原始内容：${source.label}`),
          el('pre', 'sg-workspace-text', source.text),
        );
        this.right.append(detail);
      }
    }
    this.right.append(
      button('根据此资料建立事件', () => {
        if (this.discardForm()) this.eventForm(undefined, material);
      }),
    );
  }
  private eventForm(event?: StoryEvent, material?: StoryMaterial) {
    this.right.replaceChildren(el('h3', '', event ? '编辑事件' : '新建事件'));
    const title = field('事件名称', event?.title ?? ''),
      summary = field('剧情简介', event?.summary ?? '', true),
      characters = field('参与人物（逗号分隔）', event?.characters.join('，') ?? ''),
      condition = field('前置条件', event?.preconditions ?? '', true),
      kind = select('事件类型', Object.entries(kinds), event?.kind ?? 'event');
    this.right.append(
      title.root,
      summary.root,
      characters.root,
      condition.root,
      kind.root,
      el('p', 'sg-muted', '编辑内容标为人工；原文依据单独保留。'),
    );
    this.right.append(
      button(
        '应用事件',
        () =>
          this.safe(() => {
            const input = {
              title: title.input.value,
              summary: summary.input.value,
              characters: characters.input.value
                .split(/[,，]/)
                .map((x) => x.trim())
                .filter(Boolean),
              preconditions: condition.input.value,
              kind: kind.input.value as StoryEvent['kind'],
              origin: 'user_manual' as const,
              status: 'confirmed' as const,
              materialIds: event?.materialIds ?? (material ? [material.id] : []),
            };
            let next = event
              ? actions.updateEvent(this.library, event.id, input)
              : actions.createEvent(this.library, input);
            const id = event?.id ?? next.events.at(-1)?.id;
            if (id) next = actions.addEventToRoute(next, this.routeId, id);
            this.selected = id ? { type: 'event', id } : undefined;
            this.change(next, true);
          }),
        'sg-primary',
      ),
    );
    if (event) {
      this.evidence(event);
      for (const id of event.materialIds) {
        const material = this.library.materials.find((x) => x.id === id);
        if (!material) continue;
        const reference = el('details');
        reference.append(el('summary', '', `关联资料：${material.title}（参考内容，不等同事件事实）`));
        for (const sourceId of material.sourceSnapshotIds) {
          const source = this.library.sources.find((x) => x.id === sourceId);
          if (source)
            reference.append(el('h4', '', source.label), el('pre', 'sg-workspace-text', source.text));
        }
        this.right.append(reference);
      }
      const routes = this.library.routes.filter((x) => x.eventIds.includes(event.id));
      this.right.append(
        el('p', '', `影响路线：${routes.map((x) => x.title).join('、') || '未加入路线'}`),
        button('从当前路线移除', () =>
          this.safe(() => this.change(actions.removeEventFromRoute(this.library, this.routeId, event.id))),
        ),
        button('从资料库删除事件', () => {
          if (confirm(`删除事件及关联连接，将影响 ${routes.length} 条路线。继续？`))
            this.safe(() => {
              this.selected = undefined;
              this.change(actions.deleteEvent(this.library, event.id));
            });
        }),
      );
    }
  }
  private edgeForm(edge?: StoryEdge, sourceId?: string, targetId?: string) {
    this.right.replaceChildren(el('h3', '', edge ? '编辑连接' : '建立连接'));
    const route = this.library.routes.find((x) => x.id === this.routeId);
    const events = this.library.events.filter((x) => route?.eventIds.includes(x.id));
    const options = events.map((x) => [x.id, x.title] as [string, string]);
    const from = select('来源事件', options, edge?.sourceNodeId ?? sourceId),
      to = select('目标事件', options, edge?.targetNodeId ?? targetId ?? events[1]?.id),
      type = select('连接类型', Object.entries(relations), edge?.relationType ?? 'continues'),
      label = field('玩家选择文本', edge?.choiceText ?? ''),
      condition = field('触发条件', edge?.condition ?? '', true);
    this.right.append(
      from.root,
      to.root,
      type.root,
      label.root,
      condition.root,
      el('p', 'sg-muted', '人工连接可不引用原文，保存为人工确认关系；不会冒充原作事实。'),
      button(
        '应用连接',
        () =>
          this.safe(() => {
            const input = {
              sourceNodeId: from.input.value,
              targetNodeId: to.input.value,
              relationType: type.input.value as StoryEdge['relationType'],
              choiceText: label.input.value,
              condition: condition.input.value,
              origin: 'user_manual' as const,
              status: 'confirmed' as const,
            };
            const next = edge
              ? actions.updateEdge(this.library, edge.id, input)
              : actions.createEdge(this.library, this.routeId, input);
            this.selected = { type: 'edge', id: edge?.id ?? next.edges.at(-1)?.id ?? '' };
            this.change(next, true);
          }),
        'sg-primary',
      ),
    );
    if (edge) {
      this.evidence(edge);
      this.right.append(
        button('删除连接', () => {
          if (confirm('删除此连接？事件仍保留。'))
            this.safe(() => {
              this.selected = undefined;
              this.change(actions.deleteEdge(this.library, edge.id));
            });
        }),
      );
    }
  }
  private routeForm() {
    const route = this.library.routes.find((item) => item.id === this.routeId);
    if (!route) {
      this.right.replaceChildren(el('p', '', '请先新建路线'));
      return;
    }
    this.right.replaceChildren(el('h3', '', '路线设置'));
    const title = field('路线名称', route.title);
    const kind = select(
      '路线类型',
      [
        ['common', '公共路线'],
        ['character', '人物个人线'],
        ['custom', '自定义路线'],
      ],
      route.kind,
    );
    const characters = field('路线人物（逗号分隔）', route.characters.join('，'));
    const completeness = select(
      '路线完整度',
      [
        ['fragment', '路线片段（允许未连接事件）'],
        ['playable', '完整可游玩路线（检查入口与结局）'],
      ],
      route.completeness,
    );
    this.right.append(
      title.root,
      kind.root,
      characters.root,
      completeness.root,
      el(
        'p',
        'sg-muted',
        `${route.eventIds.length}个共享事件、${route.edgeIds.length}条关系。删除路线不删除事件；复制路线共享事件与连接，布局独立。`,
      ),
      button(
        '应用路线设置',
        () =>
          this.safe(() => {
            this.change(
              updateRoute(this.library, route.id, {
                title: title.input.value,
                kind: kind.input.value as typeof route.kind,
                characters: characters.input.value
                  .split(/[,，]/)
                  .map((value) => value.trim())
                  .filter(Boolean),
                completeness: completeness.input.value as typeof route.completeness,
              }),
              true,
            );
          }),
        'sg-primary',
      ),
      button('复制为新路线', () =>
        this.safe(() => {
          if (!this.discardForm()) return;
          const next = duplicateRoute(this.library, route.id, `${route.title}（副本）`.slice(0, 160));
          this.routeId = next.routes.at(-1)?.id ?? '';
          this.selected = undefined;
          this.change(next);
        }),
      ),
      button('删除当前路线', () =>
        this.safe(() => {
          if (
            !this.discardForm() ||
            !confirm(`删除路线「${route.title}」？共享事件和连接仍保留，已保存版本可恢复。`)
          )
            return;
          const next = deleteRoute(this.library, route.id);
          this.routeId = next.routes[0]?.id ?? '';
          this.selected = undefined;
          this.change(next);
        }),
      ),
    );
  }
  private reimport() {
    void this.safe(async () => {
      const fresh = await this.app.host.snapshot();
      this.app.guard(this.snapshot);
      const next = actions.importSources(
        this.library,
        fresh.originalSources ?? fresh.sources,
        fresh.readIssues,
      );
      this.previewImport(next, '重新导入保留所有人工事件、连接和布局，只追加来源快照及新资料。');
    });
  }
  private previewImport(next: StoryLibrary, message: string) {
    if (!this.discardForm()) return;
    const base = this.library;
    this.right.replaceChildren(
      el('h3', '', '导入差异预览'),
      el('p', '', message),
      el(
        'p',
        '',
        `资料 ${this.library.materials.length} → ${next.materials.length}；事件 ${this.library.events.length} → ${next.events.length}；关系 ${this.library.edges.length} → ${next.edges.length}`,
      ),
    );
    for (const issue of next.reports.at(-1)?.issues ?? []) this.right.append(el('p', '', issue.message));
    this.right.append(
      button('确认载入草稿', () =>
        this.safe(() => {
          if (this.library !== base) throw new Error('预览期间工作台已更改，请重新导入预览，当前编辑已保留');
          if (!next.routes.length) next = actions.createRoute(next, '公共线', 'common');
          this.routeId = next.routes[0]?.id ?? '';
          this.selected = undefined;
          this.change(next);
        }),
      ),
      button('取消导入', () => this.renderDetail()),
    );
    this.tab = 'detail';
    this.applyTab();
  }
  private importFile() {
    const input = el('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () =>
      this.safe(async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 64_000_000) throw new Error('导入文件过大');
        const raw = await file.text();
        if (raw.length > 16_000_000) throw new Error('资料库超过16 MB字符限制');
        const next = parseLibrary(JSON.parse(raw));
        if (next.characterKey !== this.snapshot.characterKey)
          throw new Error('资料库属于其他角色，不能导入当前角色');
        this.previewImport(
          {
            ...next,
            id: this.library.id,
            baseRevision: this.library.baseRevision,
            revision: this.library.revision + 1,
          },
          '将载入文件为编辑草稿；当前已保存版本保留至再次保存，建议先导出当前工作台。',
        );
      }),
    );
    input.click();
  }
}
