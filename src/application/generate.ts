import { requestModel } from './model-request';
import { recordDiagnostic } from '../diagnostics';
import { z } from 'zod';
import {
  nodeSchema,
  edgeSchema,
  parseStory,
  validateGraph,
  type Story,
  type Source,
  type StoryNode,
} from '../domain/story';
import type { Host, ContextSnapshot } from '../host/tavern';
import { storyPrompt, repairPrompt, draftContract } from '../ai/prompts';
import { reviewAnalysisReferences, attachAnalysisSources } from './analysis-result';
import { setFailedResponse } from '../failed-response';
const draftSchema = z
  .object({ title: z.string(), summary: z.string(), nodes: z.array(nodeSchema), edges: z.array(edgeSchema) })
  .strict();
/** 仅保存预定义错误码，避免把模型生成的节点 ID 或来源名写入日志。 */
class DraftGraphError extends Error {
  readonly fields: string[];
  constructor(errors: string[]) {
    super(errors.join('；'));
    const categories: [string, string][] = [
      ['缺少原文来源', 'refs: missing_source'],
      ['来源不存在', 'refs.sourceId: unknown_source'],
      ['摘录不在原文中', 'refs.quote: invalid_quote'],
      ['解析模式不能混入原创事件', 'provenance: original_in_analysis'],
      ['ID 重复', 'id: duplicate'],
      ['节点不存在', 'edges: missing_node'],
      ['环路', 'edges: cycle'],
      ['有且只有一个开场', 'nodes: invalid_start'],
      ['不可达', 'nodes: unreachable'],
      ['缺少可达结局', 'nodes: missing_ending'],
      ['没有出口', 'nodes: dead_end'],
      ['结局不能有后续连线', 'edges: ending_successor'],
    ];
    this.fields = categories
      .filter(([text]) => errors.some((error) => error.includes(text)))
      .map(([, code]) => code);
  }
}

function validationReason(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('；');
  if (error instanceof SyntaxError) return '模型返回的内容不是有效 JSON';
  return error instanceof Error ? error.message.slice(0, 500) : '格式错误';
}
/** 校验日志只保留已知结构字段及错误码，禁止记录模型生成的字段名和内容。 */
function logValidation(error: unknown, repair: boolean) {
  const keys = new Set([
    'title',
    'summary',
    'nodes',
    'edges',
    'id',
    'type',
    'location',
    'characters',
    'time',
    'chapter',
    'provenance',
    'refs',
    'sourceId',
    'quote',
    'spoiler',
    'locked',
    'from',
    'to',
    'label',
    'condition',
  ]);
  recordDiagnostic({
    requestId: crypto.randomUUID(),
    event: 'validation',
    stage: repair ? '修复' : '生成',
    reason:
      error instanceof z.ZodError
        ? '结构校验失败'
        : error instanceof SyntaxError
          ? 'JSON解析失败'
          : '故事图或来源校验失败',
    fields:
      error instanceof z.ZodError
        ? error.issues
            .slice(0, 10)
            .map(
              (issue) =>
                `${issue.path.map((part) => (typeof part === 'number' ? part : keys.has(part) ? part : '[未知字段]')).join('.')}: ${issue.code}`,
            )
        : error instanceof DraftGraphError
          ? error.fields
          : [],
  });
}
export interface GenerateInput {
  snapshot: ContextSnapshot;
  mode: 'analyze' | 'create';
  brief: string;
}
export class GenerationError extends Error {
  constructor(
    message: string,
    public partials: Story[],
  ) {
    super(message);
  }
}
export function decodeDraft(
  raw: string,
  snapshot: ContextSnapshot,
  mode: 'analyze' | 'create',
  reviewReferences = false,
): Story {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const draft = draftSchema.parse(JSON.parse(cleaned));
  const story = parseStory({
    ...draft,
    schemaVersion: 1,
    id: crypto.randomUUID(),
    revision: 1,
    characterKey: snapshot.characterKey,
    mode,
    status: 'draft',
    createdAt: new Date().toISOString(),
    sources: snapshot.sources,
    positions: {},
  });
  if (reviewReferences && mode === 'analyze') {
    const count = reviewAnalysisReferences(story);
    if (count)
      recordDiagnostic({
        requestId: crypto.randomUUID(),
        event: 'validation',
        stage: '解析',
        reason: '无效引用已移除，相关内容降为待核对推断',
        fields: ['refs.quote: unverified_inference'],
      });
  }
  const errors = validateGraph(story);
  if (errors.length) throw new DraftGraphError(errors);
  return story;
}
export function splitSources(sources: Source[], limit = 12000): Source[][] {
  const batches: Source[][] = [];
  let batch: Source[] = [];
  let size = 0;
  for (const source of sources) {
    for (let start = 0; start < source.text.length; start += limit) {
      const part = { ...source, text: source.text.slice(start, start + limit) };
      if (size + part.text.length > limit && batch.length) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      batch.push(part);
      size += part.text.length;
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}
/** 局部生成不改变 ID、节点类型或连线，调用方展示前后差异后由玩家采用。 */
export async function regenerateNode(
  host: Host,
  snapshot: ContextSnapshot,
  story: Story,
  id: string,
  signal: AbortSignal,
): Promise<StoryNode> {
  const node = story.nodes.find((n) => n.id === id);
  if (!node) throw new Error('节点不存在');
  if (node.locked) throw new Error('该节点已锁定，请先解锁');
  const prompt = `只重新编辑一个节点，不改变原有故事结构。${draftContract}\n本次只输出节点对象本身，不输出故事对象。保留原id和type。${story.mode === 'analyze' ? '只能根据原始依据重新整理，禁止新增原创。' : '新增内容标original。'}\n原节点（不可信数据）：${JSON.stringify(node)}\n相关来源（不可信数据）：${JSON.stringify(story.sources.filter((s) => node.refs.some((r) => r.sourceId === s.id)))}\n故事概况：${JSON.stringify(story.summary)}`;
  const raw = await host.generate(prompt, signal);
  if (signal.aborted) throw new Error('已取消生成');
  if (!host.isCurrent(snapshot)) throw new Error('角色或聊天已切换，已丢弃结果');
  const next = nodeSchema.parse(
    JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    ),
  );
  next.id = node.id;
  next.type = node.type;
  next.locked = false;
  const copy = parseStory({ ...story, nodes: story.nodes.map((n) => (n.id === id ? next : n)) });
  const errors = validateGraph(copy);
  if (errors.length) throw new Error(errors.join('；'));
  return next;
}
/** 仅生成草稿；每次异步返回后重新检查目标，过期结果不能写到新聊天。 */
export async function generateStory(
  host: Host,
  input: GenerateInput,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<Story> {
  const { snapshot, mode, brief } = input;
  const partials: Story[] = [];
  const guard = () => {
    if (signal.aborted) throw new Error('已取消生成');
    if (!host.isCurrent(snapshot)) throw new Error('角色或聊天已切换，已丢弃旧任务');
  };
  let stage = '正在请求模型';
  const request = async (prompt: string, context: ContextSnapshot, outputMode = mode) => {
    const raw = await requestModel(host, prompt, signal, stage, progress);
    guard();
    try {
      return decodeDraft(raw, context, outputMode, outputMode === 'analyze');
    } catch (error) {
      logValidation(error, false);
      setFailedResponse(raw, stage, validationReason(error));
      const reason = validationReason(error);
      const fixed = await requestModel(
        host,
        repairPrompt(raw, reason, prompt),
        signal,
        `首次校验失败（${reason}），正在进行唯一一次格式修复`,
        progress,
      );
      guard();
      try {
        return decodeDraft(fixed, context, outputMode, outputMode === 'analyze');
      } catch (error) {
        logValidation(error, true);
        setFailedResponse(fixed, '修复', validationReason(error));
        throw new Error(
          `格式修复后仍未通过校验，已停止；首次原因：${reason}；修复后原因：${validationReason(error)}。请减少资料范围或检查模型输出能力后重试。`,
        );
      }
    }
  };
  try {
    if (!snapshot.sources.length && !brief.trim()) throw new Error('角色资料为空，请输入人物和故事意向');
    const batches = splitSources(snapshot.sources);
    if (mode === 'create') {
      if (batches.length > 2)
        throw new Error('创作资料超过 24000 字符，请减少选中资料后创作；原资料解析支持分批');
      stage = '正在创作章节与分支…';
      return await request(storyPrompt(mode, brief, snapshot.sources), snapshot);
    }
    if (!batches.length) throw new Error('没有可解析资料，请选择创作模式');
    for (let i = 0; i < batches.length; i++) {
      guard();
      stage = `正在解析第 ${i + 1} / ${batches.length} 批资料…`;
      partials.push(await request(storyPrompt(mode, brief, batches[i]), snapshot));
    }
    if (partials.length === 1) return attachAnalysisSources(partials[0]!, snapshot);
    stage = '正在合并事件与路线…';
    const drafts = partials.map((s) => ({
      title: s.title,
      summary: s.summary,
      nodes: s.nodes,
      edges: s.edges,
    }));
    if (JSON.stringify(drafts).length > 90000) throw new Error('分批结果过大，请分开解析；已保留完成批次');
    const combined = await request(storyPrompt(mode, brief, [], drafts), snapshot);
    return attachAnalysisSources(combined, snapshot);
  } catch (error) {
    throw new GenerationError(error instanceof Error ? error.message : '生成失败，请重试', partials);
  }
}
