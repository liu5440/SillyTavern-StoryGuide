import { parseStory, validateGraph, type Story } from '../domain/story';
import type { ContextSnapshot } from '../host/tavern';

/** 只建立原文目录，不把资料的存放顺序、关键词或名称推断成剧情关系。 */
export function buildLocalCatalog(snapshot: ContextSnapshot): Story {
  const sources = snapshot.sources.filter((source) => source.text.trim());
  if (!sources.length) throw new Error('请至少选择一条有正文的资料');
  if (sources.length > 500) throw new Error('本地目录最多500条，请减少选中资料');
  const story = parseStory({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    revision: 1,
    characterKey: snapshot.characterKey,
    title: `${snapshot.characterName}的资料目录`.slice(0, 160),
    summary:
      '本地资料目录，未调用AI。每张卡片对应一条原资料，尚未识别事件、先后关系或分支；原资料未提供固定路线时，不自动补造连线。',
    mode: 'analyze',
    status: 'draft',
    createdAt: new Date().toISOString(),
    sources,
    edges: [],
    positions: {},
    nodes: sources.map((source, index) => ({
      id: `source-${index + 1}`,
      type: 'event',
      title: source.label.slice(0, 160) || `资料${index + 1}`,
      summary:
        source.text.length > 19000
          ? `【原文摘录，完整内容见来源】\n${source.text.slice(0, 19000)}`
          : source.text,
      location: '',
      characters: [],
      time: '',
      chapter: '',
      provenance: 'explicit',
      refs: [{ sourceId: source.id, quote: source.text.slice(0, 2000) }],
      // 玩家主动建立的原文目录不是尚未触发的未来剧情，默认可见。
      spoiler: false,
      locked: false,
    })),
  });
  const errors = validateGraph(story);
  if (errors.length) throw new Error(errors.join('；'));
  return story;
}
