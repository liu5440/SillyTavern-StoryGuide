import { parseStory, validateGraph, type Story } from '../domain/story';
import { buildLocalCatalog } from './local-catalog';
import type { ContextSnapshot } from '../host/tavern';

/** 仅处理已经通过结构校验的分析输出；不能验证的引用不作为原文事实。 */
export function reviewAnalysisReferences(story: Story): number {
  const sources = new Map(story.sources.map((s) => [s.id, s.text]));
  let warnings = 0;
  for (const item of [...story.nodes, ...story.edges]) {
    // 解析模式的原创禁令仍交给严格校验，不能借引用降级绕过。
    if (item.provenance === 'original' || item.provenance === 'user') continue;
    const valid = item.refs.filter((ref) => sources.get(ref.sourceId)?.includes(ref.quote));
    if (valid.length === item.refs.length) continue;
    warnings++;
    item.refs = valid;
    item.provenance = 'inferred';
    if ('summary' in item)
      item.summary = `【引用未通过校验，待核对的模型推断】\n${item.summary}`.slice(0, 20000);
    else item.label = `【引用待核对】${item.label}`.slice(0, 20000);
  }
  if (warnings)
    story.summary = `【${warnings}项引用未通过校验，相关内容仅作为待核对推断】\n${story.summary}`.slice(
      0,
      20000,
    );
  return warnings;
}

/** 原始人物和设定资料不依赖模型是否识别出事件，始终作为资料卡保留。 */
export function attachAnalysisSources(story: Story, snapshot: ContextSnapshot): Story {
  if (snapshot.sources.length + story.nodes.length > 500) {
    // 来源始终完整保存在故事sources中；不为复制目录卡耗尽事件节点配额。
    return parseStory({
      ...story,
      summary:
        `【资料与事件合计超过500项，原文保留在“查看原始资料”，不重复加入事件列表】\n${story.summary}`.slice(
          0,
          20000,
        ),
    });
  }
  const catalog = buildLocalCatalog(snapshot);
  const ids = new Set(story.nodes.map((node) => node.id));
  for (const node of catalog.nodes) {
    let id = `material-${node.id}`;
    while (ids.has(id)) id = `_${id}`;
    ids.add(id);
    node.id = id;
    node.title = `资料｜${node.title}`.slice(0, 160);
    node.chapter = '原始资料（不代表事件）';
  }
  const combined = parseStory({ ...story, nodes: [...catalog.nodes, ...story.nodes] });
  const errors = validateGraph(combined);
  if (errors.length) throw new Error(errors.join('；'));
  return combined;
}
