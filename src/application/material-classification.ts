import { parseLibrary, type StoryLibrary, type StoryMaterial } from '../domain/library';

const categories: StoryMaterial['categories'][number][] = [
  'character',
  'location',
  'world',
  'plot',
  'rule',
  'unclassified',
];
/** 全量校验后一次人工分类；不改事实、证据、审核或创建剧情实体。 */
export function classifyMaterials(lib: StoryLibrary, ids: string[], category: string): StoryLibrary {
  if (!ids.length) throw new Error('请先选择资料');
  const validCategory = categories.find((value) => value === category);
  if (!validCategory) throw new Error('分类无效');
  const selected = new Set(ids);
  if ([...selected].some((id) => !lib.materials.some((m) => m.id === id)))
    throw new Error('资料不存在，请重新选择');
  return parseLibrary({
    ...lib,
    revision: lib.revision + 1,
    materials: lib.materials.map((m) =>
      selected.has(m.id)
        ? {
            ...m,
            revision: m.revision + 1,
            categories: [validCategory],
            userEdited: true,
          }
        : m,
    ),
  });
}
