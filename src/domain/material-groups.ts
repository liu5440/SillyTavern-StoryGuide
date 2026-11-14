import type { StoryLibrary, StoryMaterial } from './library';

export interface MaterialGroup {
  material: StoryMaterial;
  members: StoryMaterial[];
}
/** 仅折叠原文完全一致且整理状态相同的显示项；快照、实体及人工正文不合并。 */
export function groupMaterials(lib: StoryLibrary): MaterialGroup[] {
  const sources = new Map(lib.sources.map((s) => [s.id, s]));
  const groups = new Map<string, MaterialGroup>();
  for (const material of lib.materials) {
    const snapshot =
      material.sourceSnapshotIds.length === 1 ? sources.get(material.sourceSnapshotIds[0] ?? '') : undefined;
    const foldable =
      snapshot?.text &&
      material.origin === 'worldbook_explicit' &&
      material.title === (snapshot.label.slice(0, 160) || '未命名资料');
    const key = foldable
      ? JSON.stringify([
          snapshot.text,
          snapshot.disabled,
          [...material.categories].sort(),
          material.summary,
          material.status,
          [...material.relatedEventIds].sort(),
        ])
      : JSON.stringify(['independent', material.id]);
    const prior = groups.get(key);
    if (prior) prior.members.push(material);
    else groups.set(key, { material, members: [material] });
  }
  return [...groups.values()];
}
