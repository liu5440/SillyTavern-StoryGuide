import type { Story, Source } from './story';

export interface CharacterGroup {
  key: string;
  label: string;
  nodeIds: string[];
}
function cleanName(value: string): string {
  return (
    value
      .replace(/[*#"'“”]/gu, '')
      .split(/[（(\/、]/u)[0]
      ?.trim() ?? ''
  );
}
function validName(value: string): boolean {
  return value.length >= 2 && value.length <= 30 && !/[<>={}\[\]\r\n]/u.test(value);
}
/** 姓名字段优先；短标题必须同时有至少两个人物档案特征，不能把所有条目标题当人名。 */
export function sourceNames(source: Source): string[] {
  const names = new Set<string>();
  const pattern =
    /(?:^|[\n{,，])\s*(?:[-*#]\s*)?["'“”*]*(?:姓名|角色姓名|角色名|人物姓名|人物名)["'“”*]*\s*[:：]\s*["'“”]*([^\n\r"'“”<>，,;；。{}\[\]|]+)/gu;
  for (const match of source.text.matchAll(pattern)) {
    const name = cleanName(match[1] ?? '');
    if (validName(name)) names.add(name);
  }
  if (!names.size && !source.id.startsWith('card:')) {
    const title = cleanName(source.label.split('/').at(-1) ?? '');
    const features = ['性格', '外貌', '身份', '年龄', '种族', '人物简介', '角色介绍'].filter((word) =>
      source.text.includes(word),
    );
    if (
      validName(title) &&
      title.length <= 16 &&
      features.length >= 2 &&
      !/规则|变量|索引|世界观|说明|声明|格式|初始化|事件|场景|人物描述|开场白|背景|总览|性格|外貌|年龄|身份/u.test(
        title,
      )
    )
      names.add(title);
  }
  return [...names];
}

/** 选择资料时即建立索引，不依赖AI已生成事件。关键词提及只是浏览归组。 */
export function sourceGroups(sources: Source[]): { label: string; sourceIds: string[] }[] {
  const roster = [...new Set(sources.flatMap(sourceNames))];
  const groups = roster.map((name) => ({
    label: name,
    sourceIds: sources.filter((s) => sourceNames(s).includes(name) || s.text.includes(name)).map((s) => s.id),
  }));
  const assigned = new Set(groups.flatMap((group) => group.sourceIds));
  return [
    ...groups,
    { label: '公共／未分类', sourceIds: sources.filter((s) => !assigned.has(s.id)).map((s) => s.id) },
  ];
}

/** 仅生成浏览索引，不改变节点、引用或剧情关系；多人条目可同时归入多个分组。 */
export function characterGroups(story: Story): CharacterGroup[] {
  const roster = new Set(story.sources.flatMap(sourceNames));
  for (const node of story.nodes)
    for (const name of node.characters) if (name.trim()) roster.add(name.trim());
  const map = new Map<string, string[]>();
  const sourcesById = new Map(story.sources.map((source) => [source.id, source]));
  const unassigned: string[] = [];
  for (const node of story.nodes) {
    const named = [...new Set(node.characters.map((name) => name.trim()).filter(Boolean))];
    const localExcerptMarker = '【原文摘录，完整内容见来源】\n';
    const fullLocalTexts = node.refs.flatMap((ref) => {
      const source = sourcesById.get(ref.sourceId);
      if (!source) return [];
      // 只有原文目录/完整摘录节点使用完整来源；AI事件不因引用整份资料而关联所有人物。
      return node.summary === source.text ||
        (node.summary.startsWith(localExcerptMarker) &&
          source.text.startsWith(node.summary.slice(localExcerptMarker.length)))
        ? [source.text]
        : [];
    });
    const text = [node.title, node.summary, ...fullLocalTexts].join('\n');
    const names = named.length ? named : [...roster].filter((name) => text.includes(name));
    if (!names.length) unassigned.push(node.id);
    for (const name of names) {
      const nodes = map.get(name) ?? [];
      nodes.push(node.id);
      map.set(name, nodes);
    }
  }
  return [
    { key: 'all', label: '全部资料', nodeIds: story.nodes.map((node) => node.id) },
    ...[...map]
      .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
      .map(([name, nodeIds]) => ({ key: `character:${name}`, label: name, nodeIds })),
    { key: 'unassigned', label: '公共／未分类', nodeIds: unassigned },
  ];
}
