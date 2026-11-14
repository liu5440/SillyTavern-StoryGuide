import { sceneSchema, type Material } from '../domain/materials';
import { field, el } from './dom';

/** 仅编辑归纳；证据和原文不进入可修改表单。 */
export function sceneFields(card: Pick<Material, 'scene'>) {
  const root = el('div', 'sg-scene-fields');
  const scene = card.scene;
  if (!scene) return undefined;
  const labels = {
    participants: '参与人物（每行一项）',
    location: '地点',
    time: '时间',
    context: '前情',
    trigger: '触发条件',
    keyEvents: '关键事件（每行一项）',
    choices: '玩家选择（每行一项）',
    relationshipChanges: '关系变化（每行一项）',
    consequences: '后果（每行一项）',
  } as const;
  const entries = Object.entries(labels).map(([key, label]) => {
    const name = key as keyof typeof labels;
    const value = scene[name];
    const control = field(label, Array.isArray(value) ? value.join('\n') : value, true);
    root.append(control.root);
    return { name, input: control.input, original: control.input.value, array: Array.isArray(value) };
  });
  return {
    root,
    read(manualRevision = false) {
      const changed = entries.some(({ input, original }) => input.value !== original);
      const data = Object.fromEntries(
        entries.map(({ name, input, array }) => [
          name,
          array
            ? input.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
            : input.value,
        ]),
      );
      return sceneSchema.parse({
        ...data,
        summaryOrigin: changed || manualRevision ? 'user_manual' : scene.summaryOrigin,
        status: 'confirmed',
      });
    },
  };
}
