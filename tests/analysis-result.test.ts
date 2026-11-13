import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, validateGraph } from '../src/domain/story';
import { reviewAnalysisReferences, attachAnalysisSources } from '../src/application/analysis-result';
import { fixture, source } from './fixtures';
import { failedResponse, setFailedResponse, clearFailedResponse } from '../src/failed-response';
import { diagnosticReport } from '../src/diagnostics';
import { sourceGroups } from '../src/domain/character-groups';
import type { ContextSnapshot } from '../src/host/tavern';

test('错误引用逐项降为待核对推断，不伪造摘录；严格校验保持拒绝原结果', () => {
  const story = parseStory({ ...fixture(), mode: 'analyze' });
  story.nodes[0]!.provenance = 'explicit';
  story.nodes[0]!.refs = [{ sourceId: source.id, quote: '不存在的引用' }];
  story.nodes[1]!.provenance = 'inferred';
  for (const edge of story.edges) edge.provenance = 'inferred';
  assert.ok(validateGraph(story).some((error) => error.includes('摘录不在原文')));
  assert.equal(reviewAnalysisReferences(story), 1);
  assert.equal(story.nodes[0]!.provenance, 'inferred');
  assert.deepEqual(story.nodes[0]!.refs, []);
  assert.match(story.nodes[0]!.summary, /待核对/);
  assert.deepEqual(validateGraph(story), []);
});

test('只有人物资料、没有事件时仍保留原文卡片与可定位引用', () => {
  const story = parseStory({ ...fixture(), mode: 'analyze', nodes: [], edges: [] });
  const snapshot = {
    characterKey: story.characterKey,
    characterName: '测试',
    sources: [source],
  } as ContextSnapshot;
  const result = attachAnalysisSources(story, snapshot);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0]!.summary, source.text);
  assert.match(result.nodes[0]!.chapter, /不代表事件/);
  assert.deepEqual(validateGraph(result), []);
});

test('选择前即可按人物与公共资料归组，多人资料出现在多个组', () => {
  const sources = ['姓名：青岚', '姓名：白榆', '青岚与白榆一起调查。', '通用规则'].map((text, index) => ({
    ...source,
    id: `s${index}`,
    text,
  }));
  const groups = sourceGroups(sources);
  assert.deepEqual(groups.find((g) => g.label === '青岚')?.sourceIds, ['s0', 's2']);
  assert.deepEqual(groups.find((g) => g.label === '白榆')?.sourceIds, ['s1', 's2']);
  assert.deepEqual(groups.find((g) => g.label === '公共／未分类')?.sourceIds, ['s3']);
});

test('失败正文单独存于内存，不进入普通日志，清空后不可读', () => {
  setFailedResponse('私有失败正文', '修复', 'JSON解析失败');
  assert.equal(failedResponse()?.text, '私有失败正文');
  assert.ok(!JSON.stringify(diagnosticReport()).includes('私有失败正文'));
  clearFailedResponse();
  assert.equal(failedResponse(), undefined);
});

test('错误引用不能让解析模式的原创事件绕过禁令', () => {
  const story = parseStory({ ...fixture(), mode: 'analyze' });
  story.nodes[0]!.provenance = 'original';
  story.nodes[0]!.refs = [{ sourceId: source.id, quote: '无效引用' }];
  reviewAnalysisReferences(story);
  assert.equal(story.nodes[0]!.provenance, 'original');
  assert.ok(validateGraph(story).some((error) => error.includes('解析模式不能混入原创事件')));
});

test('大量来源不挤占事件节点配额，原文仍完整保留', () => {
  const sources = Array.from({ length: 501 }, (_, index) => ({ ...source, id: `s${index}` }));
  const story = parseStory({ ...fixture(), mode: 'analyze', sources, nodes: [], edges: [] });
  const snapshot = { characterKey: story.characterKey, characterName: '测试', sources } as ContextSnapshot;
  const result = attachAnalysisSources(story, snapshot);
  assert.equal(result.sources.length, 501);
  assert.equal(result.nodes.length, 0);
  assert.match(result.summary, /查看原始资料/);
});
