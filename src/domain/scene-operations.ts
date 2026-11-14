import { z } from 'zod';
import { materialSchema, materialIdSchema, type Material } from './materials';

export type SceneEdit = Pick<Material, 'title' | 'description' | 'scene'>;
/** 拆分/合并仅复用已有证据，新摘要由用户填写；原记录始终保留。 */
export function deriveScenes(
  inputs: Material[],
  edits: SceneEdit[],
  nextId = () => crypto.randomUUID(),
): Material[] {
  const sources = z.array(materialSchema).min(1).max(200).parse(inputs);
  if (sources.some((card) => card.origin !== 'dialogue' || !card.scene || !card.evidence?.length))
    throw new Error('只能拆分或合并已保存的关键场景');
  if (new Set(sources.map((card) => card.id)).size !== sources.length)
    throw new Error('不能重复选择同一场景');
  if (edits.length < 1 || edits.length > 20) throw new Error('每次整理1–20个场景');
  if (edits.some((edit) => !edit.scene)) throw new Error('请填写关键场景归纳');
  const evidence = [
    ...new Map(
      sources.flatMap((card) => card.evidence ?? []).map((item) => [JSON.stringify(item), item]),
    ).values(),
  ];
  if (evidence.length > 30) throw new Error('合并后证据超过30段，请缩小范围；原文未截断');
  return edits.map((edit) =>
    materialSchema.parse({
      ...sources[0],
      title: edit.title,
      description: edit.description,
      id: `personal:${nextId()}`,
      method: undefined,
      opening: '',
      scene: edit.scene ? { ...edit.scene, summaryOrigin: 'user_manual', status: 'confirmed' } : undefined,
      evidence,
      derivedFromIds: sources.map((card) => card.id),
      relatedEventIds: [],
      relatedRouteIds: [],
    }),
  );
}

const backupSchema = z
  .object({
    format: z.literal('story-guide-materials'),
    schemaVersion: z.literal(1),
    user: z.string().min(1).optional(),
    characterKey: z.string().min(1),
    materials: z.array(materialSchema).max(200),
    favorites: z.array(materialIdSchema).max(500),
  })
  .strict();
/** 旧备份未记录账号，必须在预览明示；带账号的新备份严格匹配当前边界。 */
export function previewMaterialBackup(text: string, user: string, character: string, current: Material[]) {
  if (text.length > 8_000_000) throw new Error('素材备份超过800万字符，未导入');
  const data = backupSchema.parse(JSON.parse(text));
  if (data.characterKey !== character || (data.user !== undefined && data.user !== user))
    throw new Error('备份不属于当前账号或角色');
  if (data.materials.some((card) => card.origin !== 'dialogue')) throw new Error('备份不能注入内置素材');
  if (new Set(data.materials.map((card) => card.id)).size !== data.materials.length)
    throw new Error('备份素材ID重复');
  if (
    !data.materials.length ||
    current.filter((card) => card.origin === 'dialogue').length + data.materials.length > 200
  )
    throw new Error('导入后超过每角色200条，或备份没有个人素材');
  const ids = new Map(data.materials.map((card) => [card.id, `personal:${crypto.randomUUID()}`]));
  const conflicts = data.materials
    .filter((card) => current.some((row) => row.id === card.id))
    .map((card) => card.title);
  const cards = data.materials.map((card) =>
    materialSchema.parse({
      ...card,
      id: ids.get(card.id),
      relatedEventIds: [],
      relatedRouteIds: [],
      derivedFromIds: card.derivedFromIds?.map((id) => ids.get(id) ?? id),
    }),
  );
  return {
    cards,
    favorites: data.favorites.flatMap((id) => {
      const mapped = ids.get(id);
      return mapped ? [mapped] : [];
    }),
    conflicts,
    legacyAccount: data.user === undefined,
  };
}
