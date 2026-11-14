import type { GuideController } from '../application/controller';
import type { ContextSnapshot } from '../host/tavern';
import type { StoryLibrary, RouteDraft } from '../domain/library';
import { generateRouteDraft } from '../application/route-drafts';
import { adoptRouteDraft, reviewDraftItem, editDraftItem } from '../domain/route-drafts';
import { el, button, field, check } from './dom';

/** 工坊仅编辑独立候选；持久化统一交回工作台，正式图由采用用例更新。 */
export function openRouteWorkshop(
  app: GuideController,
  snapshot: ContextSnapshot,
  getLibrary: () => StoryLibrary,
  onChange: (next: StoryLibrary) => void,
) {
  if (document.querySelector('.sg-route-workshop')) return;
  const previous = document.activeElement;
  const dialog = el('dialog', 'sg-route-workshop');
  dialog.setAttribute('aria-label', 'AI 剧情工坊');
  const status = el(
    'p',
    'sg-route-workshop-status',
    '候选不会进入正式图；返回工作台保存后，关闭和刷新均可恢复草稿。',
  );
  status.setAttribute('role', 'status');
  const form = el('section', 'sg-route-workshop-form');
  const preview = el('section', 'sg-route-workshop-preview');
  let controller: AbortController | undefined;
  let closed = false,
    frozen = false,
    selected = getLibrary().drafts.at(-1)?.id ?? '';
  const current = () => !closed && !frozen && app.host.isCurrent(snapshot);
  const guard = () => {
    app.guard(snapshot);
    if (!current()) throw new Error('窗口已关闭或角色已变化，请重新打开工坊');
  };
  const safe = (action: () => void) => {
    try {
      guard();
      action();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  const change = (next: StoryLibrary) => {
    guard();
    onChange(next);
    render();
  };
  const close = () => {
    if (edited && !confirm('候选表单尚未应用，放弃输入并返回？')) return;
    dialog.close();
  };
  const header = el('header');
  header.append(el('h2', '', 'AI 剧情工坊'), button('返回正式路线', close));
  const mode = el('select');
  mode.setAttribute('aria-label', '生成模式');
  for (const [value, label] of [
    ['infer', '推断关系（仅已有事件）'],
    ['expand', '扩展创作'],
    ['mixed', '混合（保留已有事件）'],
  ] as const) {
    const option = el('option', '', label);
    option.value = value;
    mode.append(option);
  }
  mode.value = 'expand';
  const style = field('风格', '尊重人物设定'),
    length = field('长度', '短篇');
  const characters = new Set<string>(),
    sources = new Set<string>(),
    events = new Set<string>();
  const choices = (title: string, items: { id: string; title: string }[], chosen: Set<string>) => {
    const group = el('fieldset');
    group.append(el('legend', '', title));
    if (!items.length) group.append(el('p', '', '无可选项；无世界书也可原创。'));
    for (const item of items)
      group.append(
        check(item.title, false, (checked) => {
          if (checked) chosen.add(item.id);
          else chosen.delete(item.id);
        }).root,
      );
    return group;
  };
  const lib = getLibrary();
  form.append(
    mode,
    style.root,
    length.root,
    choices(
      '目标人物',
      lib.materials.filter((m) => m.categories.includes('character')),
      characters,
    ),
    choices(
      '参考世界书／角色资料（仅发送勾选内容）',
      lib.sources.map((s) => ({ id: s.id, title: s.label })),
      sources,
    ),
    choices('参考已有事件（仅发送勾选事件）', lib.events, events),
  );
  let edited = false;
  const pending = new Map<
    string,
    { title?: string; summary?: string; condition?: string; choiceText?: string }
  >();
  const remember = (
    id: string,
    patch: { title?: string; summary?: string; condition?: string; choiceText?: string },
  ) => {
    pending.set(id, patch);
    edited = true;
  };
  const apply = (
    draftId: string,
    itemId: string,
    patch: { title?: string; summary?: string; condition?: string; choiceText?: string },
  ) => {
    const next = editDraftItem(getLibrary(), draftId, itemId, patch);
    onChange(next);
    pending.delete(itemId);
    edited = pending.size > 0;
    render();
  };
  const generate = button('生成路线草稿', async () => {
    if (controller) return;
    try {
      guard();
      if (edited) throw new Error('请先应用候选编辑');
      if (!sources.size && !characters.size && !events.size)
        throw new Error('请至少选择一项人物、角色资料或已有事件作为生成依据');
      const base = getLibrary();
      controller = new AbortController();
      generate.disabled = true;
      status.textContent = '正在请求模型并校验草稿…可取消';
      const next = await generateRouteDraft(
        app.host,
        base,
        {
          mode: mode.value as RouteDraft['mode'],
          targetCharacterMaterialIds: [...characters],
          referenceSourceIds: [...sources],
          referenceEventIds: [...events],
          style: style.input.value,
          length: length.input.value,
        },
        controller.signal,
        () => current() && getLibrary() === base,
        (message) => {
          if (!closed) status.textContent = message;
        },
      );
      guard();
      if (getLibrary() !== base) throw new Error('工作台已变化，旧请求结果未载入');
      selected = next.drafts.at(-1)?.id ?? '';
      change(next);
      status.textContent = '草稿已生成';
    } catch (error) {
      if (!closed) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      controller = undefined;
      generate.disabled = frozen;
    }
  });
  form.append(
    generate,
    button('取消生成', () => {
      controller?.abort();
      status.textContent = '已取消生成；已有草稿保留';
    }),
  );
  function render() {
    preview.replaceChildren(el('h3', '', '草稿预览（与正式路线隔离）'));
    const library = getLibrary();
    const choose = el('select');
    choose.setAttribute('aria-label', '已有草稿');
    for (const draft of library.drafts) {
      const option = el('option', '', `${draft.mode} · ${draft.id}`);
      option.value = draft.id;
      choose.append(option);
    }
    choose.value = selected;
    choose.addEventListener('change', () => {
      if (edited && !confirm('放弃尚未应用的候选编辑？')) {
        choose.value = selected;
        return;
      }
      edited = false;
      pending.clear();
      selected = choose.value;
      render();
    });
    preview.append(choose);
    const draft = library.drafts.find((d) => d.id === selected);
    if (!draft) {
      preview.append(el('p', '', '尚无草稿，生成后可逐项编辑、确认或拒绝。'));
      return;
    }
    preview.append(
      el(
        'p',
        '',
        `差异：新增事件 ${draft.proposedEvents.length}、关系 ${draft.proposedEdges.length}、路线 ${draft.proposedRoutes.length}。确认不会立即采用；依赖必须一起确认。`,
      ),
    );
    if (!draft.baselineFingerprint)
      preview.append(el('p', '', '旧版草稿仅供恢复阅读，缺少正式基线，请重新生成后采用。'));
    const titleOf = (id: string) =>
      [...library.events, ...draft.proposedEvents].find((e) => e.id === id)?.title ?? id;
    const list = el('div', 'sg-route-workshop-list');
    for (const item of [...draft.proposedEvents, ...draft.proposedEdges, ...draft.proposedRoutes]) {
      const row = el('article', 'sg-route-workshop-item');
      const adopted = draft.adoptedItemIds?.includes(item.id);
      const state = draft.itemReviews?.[item.id] ?? ('status' in item ? item.status : 'pending');
      row.append(
        el(
          'h4',
          '',
          'title' in item ? item.title : `${titleOf(item.sourceNodeId)} → ${titleOf(item.targetNodeId)}`,
        ),
        el(
          'p',
          '',
          `${'origin' in item ? { ai_generated: 'AI 创作', ai_inferred: 'AI 推断', user_manual: '人工编辑', worldbook_explicit: '原作明确' }[item.origin] : '候选路线'} · ${state}`,
        ),
      );
      if ('title' in item) {
        const title = field('候选名称', pending.get(item.id)?.title ?? item.title);
        row.append(title.root);
        const summary =
          'summary' in item
            ? field('候选简介', pending.get(item.id)?.summary ?? item.summary, true)
            : undefined;
        if (summary) row.append(summary.root);
        const patch = () => ({
          title: title.input.value,
          ...(summary ? { summary: summary.input.value } : {}),
        });
        title.input.addEventListener('input', () => remember(item.id, patch()));
        summary?.input.addEventListener('input', () => remember(item.id, patch()));
        row.append(button('应用候选编辑', () => safe(() => apply(draft.id, item.id, patch()))));
      } else {
        const condition = field('候选触发条件', pending.get(item.id)?.condition ?? item.condition, true),
          choice = field('候选选择文本', pending.get(item.id)?.choiceText ?? item.choiceText);
        const patch = () => ({ condition: condition.input.value, choiceText: choice.input.value });
        condition.input.addEventListener('input', () => remember(item.id, patch()));
        choice.input.addEventListener('input', () => remember(item.id, patch()));
        row.append(
          condition.root,
          choice.root,
          button('应用候选编辑', () => safe(() => apply(draft.id, item.id, patch()))),
        );
      }
      if ('evidence' in item)
        for (const evidence of item.evidence) {
          const source = library.sources.find((s) => s.id === evidence.sourceSnapshotId);
          row.append(
            el(
              'p',
              '',
              `依据：${source?.label ?? evidence.sourceSnapshotId} [${evidence.start}, ${evidence.end}) · ${evidence.quote}`,
            ),
          );
        }
      for (const [state, label] of [
        ['confirmed', '确认此项'],
        ['rejected', '拒绝此项'],
      ] as const)
        row.append(
          button(label, () =>
            safe(() => {
              if (edited) throw new Error('请先应用候选编辑');
              change(reviewDraftItem(getLibrary(), draft.id, item.id, state));
            }),
          ),
        );
      if (adopted) {
        row.append(el('p', '', '已采用 · 正式路线中保留此项'));
        row
          .querySelectorAll<HTMLInputElement>('input,textarea,button')
          .forEach((control) => (control.disabled = true));
      }
      list.append(row);
    }
    const diagram = el('details', 'sg-route-workshop-diagram');
    diagram.append(el('summary', '', '图预览（候选连接）'));
    const nodes = el('div', 'sg-route-workshop-nodes');
    for (const event of draft.proposedEvents) nodes.append(el('div', 'sg-route-workshop-node', event.title));
    diagram.append(nodes);
    for (const edge of draft.proposedEdges)
      diagram.append(
        el(
          'p',
          '',
          `${titleOf(edge.sourceNodeId)} → ${titleOf(edge.targetNodeId)} · ${edge.choiceText} · ${edge.condition}`,
        ),
      );
    if (!draft.proposedEdges.length) diagram.append(el('p', '', '无候选连接；未自动连线。'));
    preview.append(
      diagram,
      list,
      button('采用已确认项', () =>
        safe(() => {
          if (edited) throw new Error('请先应用候选编辑');
          if (!confirm('采用已确认且依赖闭合的候选？正式路线将更新，请返回工作台保存，刷新后才可恢复。'))
            return;
          const active = getLibrary().drafts.find((d) => d.id === draft.id);
          const confirmed = [
            ...(active?.proposedEvents ?? []),
            ...(active?.proposedEdges ?? []),
            ...(active?.proposedRoutes ?? []),
          ]
            .filter(
              (item) =>
                active?.itemReviews?.[item.id] === 'confirmed' && !active.adoptedItemIds?.includes(item.id),
            )
            .map((item) => item.id);
          change(adoptRouteDraft(getLibrary(), draft.id, confirmed));
          status.textContent = '已采用；请返回工作台保存';
        }),
      ),
    );
  }
  const unsubscribe = app.host.subscribe(
    () => {
      if (!app.host.isCurrent(snapshot)) {
        frozen = true;
        controller?.abort();
        status.textContent = '角色或聊天已切换：工坊已冻结，请返回后重新打开。';
        dialog
          .querySelectorAll<HTMLInputElement>('input,select,textarea')
          .forEach((x) => (x.disabled = true));
        generate.disabled = true;
      }
    },
    () => {},
  );
  dialog.append(header, status, form, preview);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener(
    'close',
    () => {
      closed = true;
      controller?.abort();
      unsubscribe();
      dialog.remove();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  render();
}
