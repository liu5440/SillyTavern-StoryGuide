import { TavernHost, type ContextSnapshot } from '../host/tavern';
import { Repository } from '../storage/repository';
import { parseStory, runSchema, validateGraph, type Story, type RunState } from '../domain/story';
import { generateStory, regenerateNode, type GenerateInput } from './generate';
import { z } from 'zod';
import { storySchema } from '../domain/story';

const backupSchema = z
  .object({
    format: z.literal('story-guide-backup'),
    schemaVersion: z.literal(1),
    story: storySchema,
    run: runSchema.optional(),
  })
  .strict();
export function decodeImport(raw: string): { story: Story; run?: RunState } {
  if (raw.length > 8_000_000) throw new Error('导入文件过大，上限 8 MB 字符');
  const data: unknown = JSON.parse(raw);
  if (data && typeof data === 'object' && 'format' in data) {
    const backup = backupSchema.parse(data);
    return { story: parseStory(backup.story), run: backup.run };
  }
  return { story: parseStory(data) };
}

export class GuideController {
  constructor(
    readonly host = new TavernHost(),
    readonly repository = new Repository(),
  ) {}
  private async nextRevision(snapshot: ContextSnapshot, story: Story) {
    const versions = await this.repository.loadStories(snapshot.user, snapshot.characterKey);
    return Math.max(story.revision, ...versions.filter((s) => s.id === story.id).map((s) => s.revision)) + 1;
  }
  private async inheritedRun(
    snapshot: ContextSnapshot,
    old: Story,
    next: Story,
  ): Promise<RunState | undefined> {
    if (!snapshot.chatKey) return undefined;
    const run = await this.repository.loadRun(
      snapshot.user,
      snapshot.characterKey,
      snapshot.chatKey,
      old.id,
      old.revision,
    );
    if (!run) return undefined;
    const ids = new Set(next.nodes.map((n) => n.id));
    const edges = new Set(next.edges.map((e) => e.id));
    return {
      ...run,
      revision: next.revision,
      current: ids.has(run.current) ? run.current : '',
      states: Object.fromEntries(Object.entries(run.states).filter(([id]) => ids.has(id))),
      choices: run.choices.filter((id) => edges.has(id)),
      needsReview: true,
    };
  }
  async load(books?: string[], skipped?: string[]) {
    const snapshot = await this.host.snapshot(books, skipped);
    const stories = await this.repository.loadStories(snapshot.user, snapshot.characterKey);
    if (!this.host.isCurrent(snapshot)) throw new Error('角色已切换，请重新读取');
    return { snapshot, stories };
  }
  async generate(input: GenerateInput, signal: AbortSignal, progress: (s: string) => void) {
    return generateStory(this.host, input, signal, progress);
  }
  async regenerate(snapshot: ContextSnapshot, story: Story, id: string, signal: AbortSignal) {
    this.guardStory(snapshot, story);
    return regenerateNode(this.host, snapshot, story, id, signal);
  }
  async save(snapshot: ContextSnapshot, story: Story): Promise<Story> {
    this.guardStory(snapshot, story);
    const saved = parseStory({
      ...story,
      revision: await this.nextRevision(snapshot, story),
      createdAt: new Date().toISOString(),
      status: 'draft',
    });
    this.guardStory(snapshot, story);
    const run = await this.inheritedRun(snapshot, story, saved);
    this.guardStory(snapshot, story);
    await this.repository.saveVersion(snapshot.user, saved, run);
    this.guard(snapshot);
    return saved;
  }
  async adopt(snapshot: ContextSnapshot, story: Story): Promise<Story> {
    this.guardStory(snapshot, story);
    const errors = validateGraph(story);
    if (errors.length) throw new Error(errors.join('；'));
    const adopted = parseStory({
      ...story,
      revision: await this.nextRevision(snapshot, story),
      status: 'adopted',
      createdAt: new Date().toISOString(),
    });
    this.guardStory(snapshot, story);
    const run = await this.inheritedRun(snapshot, story, adopted);
    this.guardStory(snapshot, story);
    await this.repository.saveVersion(snapshot.user, adopted, run);
    this.guard(snapshot);
    return adopted;
  }
  async run(snapshot: ContextSnapshot, story: Story): Promise<RunState> {
    const run = snapshot.chatKey
      ? await this.repository.loadRun(
          snapshot.user,
          snapshot.characterKey,
          snapshot.chatKey,
          story.id,
          story.revision,
        )
      : undefined;
    if (run) return { ...run, needsReview: run.needsReview || run.transcript !== snapshot.transcript };
    return {
      schemaVersion: 1,
      storyId: story.id,
      revision: story.revision,
      chatKey: snapshot.chatKey,
      current: story.nodes.find((n) => n.type === 'start' && !n.spoiler)?.id ?? '',
      states: {},
      choices: [],
      variables: {},
      transcript: snapshot.transcript,
      needsReview: false,
    };
  }
  async saveRun(snapshot: ContextSnapshot, run: RunState) {
    this.guard(snapshot);
    if (run.chatKey !== snapshot.chatKey) throw new Error('本局进度不属于当前聊天');
    await this.repository.saveRun(
      snapshot.user,
      snapshot.characterKey,
      runSchema.parse({ ...run, transcript: this.host.transcript() }),
    );
    this.guard(snapshot);
  }
  async importStory(snapshot: ContextSnapshot, raw: string): Promise<Story> {
    this.guard(snapshot);
    if (raw.length > 8_000_000) throw new Error('导入文件过大，上限 8 MB 字符');
    const { story } = decodeImport(raw);
    const errors = validateGraph(story);
    if (errors.length) throw new Error(errors.join('；'));
    // 导入始终另存副本，不覆盖同 ID 的既有手工修订。
    const copy = {
      ...story,
      id: crypto.randomUUID(),
      revision: 1,
      characterKey: snapshot.characterKey,
      status: 'draft' as const,
      createdAt: new Date().toISOString(),
    };
    await this.repository.saveStory(snapshot.user, copy);
    return copy;
  }
  async restoreRun(snapshot: ContextSnapshot, story: Story, run: RunState) {
    const restored = {
      ...run,
      storyId: story.id,
      revision: story.revision,
      chatKey: snapshot.chatKey,
      needsReview: true,
    };
    const ids = new Set(story.nodes.map((n) => n.id));
    if ((run.current && !ids.has(run.current)) || Object.keys(run.states).some((id) => !ids.has(id)))
      throw new Error('备份进度引用了不存在的节点');
    await this.saveRun(snapshot, restored);
    return restored;
  }
  guard(snapshot: ContextSnapshot) {
    if (!this.host.isCurrent(snapshot)) throw new Error('角色或聊天已切换，请重新打开剧情指南');
  }
  private guardStory(snapshot: ContextSnapshot, story: Story) {
    this.guard(snapshot);
    if (story.characterKey !== snapshot.characterKey)
      throw new Error('故事不属于当前角色，需通过导入另存副本');
  }
}
