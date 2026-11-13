import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, validateGraph, visibleNodes, evaluateCondition } from '../src/domain/story.ts';
import { fixture } from './fixtures.ts';

test('可接受有效分支，拒绝环路和悬空边', () => {
  const story = parseStory(fixture());
  assert.deepEqual(validateGraph(story), []);
  story.edges.push({ ...story.edges[0]!, id: 'loop', from: 'b', to: 'a' });
  assert.match(validateGraph(story).join(), /环路/);
  story.edges[0]!.to = 'missing';
  assert.match(validateGraph(story).join(), /不存在/);
});
test('事实必须引用存在的来源及真实摘录', () => {
  const data = fixture();
  const story = parseStory(data);
  story.nodes[0]!.provenance = 'explicit';
  assert.match(validateGraph(story).join(), /来源/);
  story.nodes[0]!.refs = [{ sourceId: 's1', quote: '原文没有这句话' }];
  assert.match(validateGraph(story).join(), /摘录/);
});
test('无剧透不暴露隐藏节点，当前和完成节点可查看', () => {
  const story = parseStory(fixture());
  assert.deepEqual(
    visibleNodes(story, undefined, false).map((n) => n.id),
    ['a'],
  );
  assert.equal(visibleNodes(story, { current: 'b', states: {} }, false).length, 2);
  assert.equal(visibleNodes(story, undefined, true).length, 2);
});
test('未知变量与类型错误不能判真', () => {
  assert.equal(evaluateCondition({ variable: 'trust', op: 'gte', value: 3 }, {}), 'unknown');
  assert.equal(evaluateCondition({ variable: 'trust', op: 'gte', value: 3 }, { trust: 'high' }), 'unknown');
  assert.equal(evaluateCondition({ variable: 'trust', op: 'gte', value: 3 }, { trust: 4 }), true);
});
test('拒绝超大数据与可执行字段', () => {
  assert.throws(() => parseStory({ ...fixture(), script: 'alert(1)' }));
  assert.throws(() => parseStory({ ...fixture(), nodes: Array(501).fill(fixture().nodes[0]) }));
});
