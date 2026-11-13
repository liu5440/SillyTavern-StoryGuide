import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDiagnostics,
  recordDiagnostic,
  diagnosticReport,
  classifyFailure,
  diagnosticId,
} from '../src/diagnostics';

test('日志有界、可清空、快照不能修改原记录', () => {
  clearDiagnostics();
  for (let i = 0; i < 105; i++)
    recordDiagnostic({ requestId: String(i), event: 'request', fields: ['nodes'] });
  const report = diagnosticReport();
  assert.equal(report.entries.length, 100);
  assert.equal(report.entries[0]?.requestId, '5');
  report.entries[0]?.fields?.push('changed');
  assert.deepEqual(diagnosticReport().entries[0]?.fields, ['nodes']);
  clearDiagnostics();
  assert.equal(diagnosticReport().entries.length, 0);
});

test('异常分类不保留可能含密钥与聊天的原始异常', () => {
  const secret = 'sk-private-secret 聊天正文';
  assert.equal(classifyFailure(new Error(`HTTP 429 ${secret}`)), 'HTTP 429');
  assert.ok(!classifyFailure(new Error(secret)).includes(secret));
  const signal = new AbortController().signal;
  assert.equal(diagnosticId(signal), diagnosticId(signal));
  assert.notEqual(diagnosticId(signal), diagnosticId(new AbortController().signal));
});
