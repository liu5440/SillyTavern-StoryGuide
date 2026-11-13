import type { Source } from '../domain/story';
import { sourceGroups } from '../domain/character-groups';
import { el, button, check } from './dom';

/** 只管理选中ID；多人资料共用同一选择状态，筛选不会丢失隐藏选项。 */
export function sourceSelection(sources: Source[], selected: Set<string>): HTMLElement {
  const root = el('details', 'sg-details');
  root.open = true;
  root.append(el('summary', '', `分析资料（${sources.length} 条）`));
  const search = el('input');
  search.placeholder = '搜索人物或资料';
  search.setAttribute('aria-label', '搜索分析资料');
  const count = el('p', 'sg-muted');
  const list = el('div', 'sg-source-list');
  const groups = sourceGroups(sources);
  let refresh = () => {};
  const update = (ids: string[], yes: boolean) => {
    for (const id of ids)
      if (yes) selected.add(id);
      else selected.delete(id);
    refresh();
  };
  const toolbar = el('div', 'sg-toolbar');
  toolbar.append(
    button('全选资料', () =>
      update(
        sources.map((s) => s.id),
        true,
      ),
    ),
    button('取消全选资料', () =>
      update(
        sources.map((s) => s.id),
        false,
      ),
    ),
  );
  const render = () => {
    const sync: (() => void)[] = [];
    sync.push(() => {
      count.textContent = `已选 ${sources.filter((s) => selected.has(s.id)).length} / ${sources.length} 条 · ${sources.filter((s) => selected.has(s.id)).reduce((n, s) => n + s.text.length, 0)} 字符`;
    });
    list.replaceChildren();
    const term = search.value.trim().toLocaleLowerCase();
    for (const group of groups) {
      const visible = sources.filter(
        (s) =>
          group.sourceIds.includes(s.id) &&
          (!term || `${group.label}\n${s.label}\n${s.text}`.toLocaleLowerCase().includes(term)),
      );
      if (!visible.length) continue;
      const section = el('details', 'sg-source-group');
      section.open = true;
      const heading = el('summary');
      sync.push(() => {
        heading.textContent = `${group.label}（${visible.filter((s) => selected.has(s.id)).length}/${visible.length}）`;
      });
      section.append(heading);
      const actions = el('div', 'sg-toolbar');
      actions.append(
        button('全选本组', () =>
          update(
            visible.map((s) => s.id),
            true,
          ),
        ),
        button('取消本组', () =>
          update(
            visible.map((s) => s.id),
            false,
          ),
        ),
      );
      section.append(actions);
      for (const source of visible) {
        const row = check(
          `${source.label}${source.disabled ? '（原条目已禁用）' : ''}`,
          selected.has(source.id),
          (yes) => update([source.id], yes),
        );
        sync.push(() => {
          row.input.checked = selected.has(source.id);
        });
        section.append(row.root);
      }
      list.append(section);
    }
    if (!list.childElementCount) list.append(el('p', 'sg-muted', '没有匹配资料'));
    refresh = () => sync.forEach((update) => update());
    refresh();
  };
  search.addEventListener('input', render);
  root.append(
    search,
    toolbar,
    count,
    el(
      'p',
      'sg-muted',
      '按姓名与原文提及辅助分组；多人资料可出现在多个组，勾选状态同步。搜索后的组操作仅影响显示资料。',
    ),
    list,
  );
  render();
  return root;
}

/** 所有原始资料独立于事件节点上限，全文用纯文本展示。 */
export function sourceCatalog(sources: Source[]): HTMLElement {
  const root = el('div');
  for (const group of sourceGroups(sources)) {
    if (!group.sourceIds.length) continue;
    const section = el('details', 'sg-details');
    section.open = true;
    section.append(el('summary', '', `${group.label}（${group.sourceIds.length}）`));
    for (const source of sources.filter((s) => group.sourceIds.includes(s.id))) {
      const row = el('details');
      row.append(el('summary', '', source.label));
      const text = el('pre', '', source.text);
      text.style.whiteSpace = 'pre-wrap';
      text.style.overflowWrap = 'anywhere';
      row.append(text);
      section.append(row);
    }
    root.append(section);
  }
  return root;
}
