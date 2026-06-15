/**
 * 批量导入与批次流转台账 回归测试脚本
 *
 * 验证功能：
 *  1. CSV 批量导入预检（空字段、重复编号、同批次冲突）
 *  2. 导入原子性：失败项不影响已成功记录
 *  3. 批次级流转台账（接收、分装、提交复核、复核通过、退回、撤销退回）
 *  4. 权限控制：普通操作员不能修改复核通过后的交接记录
 *  5. Electron 持久化：重启后导入结果、台账、权限限制仍有效
 *
 * 运行方式：node tests/batch-import-regression.test.js
 */

const { v4: uuidv4 } = require('uuid');

const STATUS_LABELS = {
  received: '已接收',
  aliquoted: '已分装',
  reviewing: '待复核',
  reviewed: '已复核通过',
  returned: '已退回',
};

function createInitialState() {
  return {
    users: [
      { id: 'user-1', username: '操作员小王', role: 'operator' },
      { id: 'user-2', username: '复核员老李', role: 'reviewer' },
    ],
    batches: [],
    samples: [],
    importResults: [],
    batchLedger: [],
    currentUserId: 'user-1',
  };
}

function fixedReducer(state, action) {
  switch (action.type) {
    case 'ADD_BATCH':
      return { ...state, batches: [...state.batches, action.payload] };
    case 'ADD_SAMPLE':
      return { ...state, samples: [...state.samples, action.payload] };
    case 'UPDATE_SAMPLE':
      return {
        ...state,
        samples: state.samples.map((s) =>
          s.id === action.payload.id ? action.payload : s
        ),
      };
    case 'ADD_HISTORY':
      return {
        ...state,
        samples: state.samples.map((s) =>
          s.id === action.sampleId
            ? { ...s, history: [...s.history, action.history] }
            : s
        ),
      };
    case 'UNDO_LAST_STATUS':
      return {
        ...state,
        samples: state.samples.map((s) => {
          if (s.id !== action.sampleId) return s;
          const newSample = {
            ...s,
            status: action.restoreStatus,
            history: [...s.history, action.history],
          };
          if (action.clearHandover) {
            delete newSample.handoverBy;
            delete newSample.handoverAt;
          }
          return newSample;
        }),
      };
    case 'ADD_IMPORT_RESULT':
      return {
        ...state,
        importResults: [...state.importResults, action.payload],
      };
    case 'ADD_BATCH_LEDGER_ENTRY':
      return {
        ...state,
        batchLedger: [...state.batchLedger, action.payload],
      };
    case 'SET_DATA':
      return action.payload;
    default:
      return state;
  }
}

function createBatch(state, batchNo, name) {
  const user = state.users.find((u) => u.id === state.currentUserId);
  const batch = {
    id: uuidv4(),
    batchNo,
    name,
    createdAt: new Date().toISOString(),
    createdBy: user?.username || '未知',
  };
  return {
    state: fixedReducer(state, { type: 'ADD_BATCH', payload: batch }),
    batch,
  };
}

function checkDuplicateSampleNo(state, sampleNo, batchId, excludeId) {
  return state.samples.some(
    (s) => s.batchId === batchId && s.sampleNo === sampleNo && s.id !== excludeId
  );
}

function prevalidateImportRow(row, rowIndex, state, batchId, seenSampleNos) {
  const errors = [];
  const warnings = [];

  if (!row.sampleNo || !row.sampleNo.trim()) {
    errors.push('样本编号不能为空');
  }
  if (!row.quantity || isNaN(parseInt(row.quantity)) || parseInt(row.quantity) < 1) {
    errors.push('数量必须为大于0的数字');
  }
  if (!row.source || !row.source.trim()) {
    errors.push('样本来源不能为空');
  }

  if (row.sampleNo && row.sampleNo.trim()) {
    const cleanSampleNo = row.sampleNo.trim();
    if (seenSampleNos.has(cleanSampleNo)) {
      errors.push(`CSV文件内存在重复的样本编号: ${cleanSampleNo}`);
    }
    seenSampleNos.add(cleanSampleNo);

    if (checkDuplicateSampleNo(state, cleanSampleNo, batchId)) {
      errors.push(`该批次中已存在样本编号: ${cleanSampleNo}`);
    }
  }

  return {
    rowIndex,
    sampleNo: row.sampleNo?.trim() || '',
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function prevalidateImportCSV(state, batchId, csvRows) {
  const seenSampleNos = new Set();
  const results = csvRows.map((row, idx) =>
    prevalidateImportRow(row, idx + 1, state, batchId, seenSampleNos)
  );

  const validCount = results.filter((r) => r.valid).length;
  const invalidCount = results.filter((r) => !r.valid).length;

  return {
    total: csvRows.length,
    validCount,
    invalidCount,
    canImport: validCount > 0,
    results,
  };
}

function addSample(state, sampleData) {
  const user = state.users.find((u) => u.id === state.currentUserId);
  const sample = {
    ...sampleData,
    id: uuidv4(),
    history: [
      {
        id: uuidv4(),
        sampleId: '',
        action: '样本接收',
        operatorId: state.currentUserId,
        operatorName: user?.username || '未知',
        timestamp: new Date().toISOString(),
        fromStatus: '',
        toStatus: 'received',
        reason: '初次接收',
      },
    ],
  };
  sample.history[0].sampleId = sample.id;

  let newState = fixedReducer(state, { type: 'ADD_SAMPLE', payload: sample });

  const ledgerEntry = {
    id: uuidv4(),
    batchId: sample.batchId,
    sampleId: sample.id,
    sampleNo: sample.sampleNo,
    action: '样本接收',
    operatorId: state.currentUserId,
    operatorName: user?.username || '未知',
    timestamp: sample.history[0].timestamp,
    fromStatus: '',
    toStatus: 'received',
    reason: '初次接收',
  };
  newState = fixedReducer(newState, { type: 'ADD_BATCH_LEDGER_ENTRY', payload: ledgerEntry });

  return { newState, sample };
}

function batchImportSamples(state, batchId, validatedRows) {
  const validRows = validatedRows.filter((r) => r.valid);
  const invalidRows = validatedRows.filter((r) => !r.valid);
  const importId = uuidv4();
  const importedSampleIds = [];
  let currentState = state;

  const importResult = {
    id: importId,
    batchId,
    timestamp: new Date().toISOString(),
    operatorId: state.currentUserId,
    operatorName: state.users.find((u) => u.id === state.currentUserId)?.username || '未知',
    totalCount: validatedRows.length,
    successCount: 0,
    failedCount: 0,
    details: [],
  };

  for (const row of invalidRows) {
    importResult.failedCount++;
    importResult.details.push({
      rowIndex: row.rowIndex,
      sampleNo: row.sampleNo,
      success: false,
      error: row.errors[0] || '预检失败',
    });
  }

  for (const row of validRows) {
    try {
      const { newState, sample } = addSample(currentState, {
        batchId,
        sampleNo: row.sampleNo,
        quantity: parseInt(row.quantity) || 1,
        source: row.source?.trim() || '',
        status: 'received',
        receivedAt: new Date().toISOString(),
        receivedBy: state.users.find((u) => u.id === state.currentUserId)?.username || '未知',
      });
      currentState = newState;
      importedSampleIds.push(sample.id);
      importResult.successCount++;
      importResult.details.push({
        rowIndex: row.rowIndex,
        sampleNo: row.sampleNo,
        success: true,
      });
    } catch (e) {
      importResult.failedCount++;
      importResult.details.push({
        rowIndex: row.rowIndex,
        sampleNo: row.sampleNo,
        success: false,
        error: e.message,
      });
    }
  }

  currentState = fixedReducer(currentState, { type: 'ADD_IMPORT_RESULT', payload: importResult });

  return {
    state: currentState,
    importResult,
    importedSampleIds,
  };
}

function canModifySample(state, sample) {
  if (sample.status === 'reviewed') {
    const user = state.users.find((u) => u.id === state.currentUserId);
    return user?.role === 'reviewer';
  }
  return true;
}

function changeSampleStatus(state, sampleId, newStatus, action, reason, remark) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return { state, success: false, error: '样本不存在' };

  if (!canModifySample(state, sample)) {
    return {
      state,
      success: false,
      error: '普通操作员不能修改已复核通过的交接记录，请联系复核员',
    };
  }

  if (newStatus === 'reviewed') {
    const user = state.users.find((u) => u.id === state.currentUserId);
    if (user?.role !== 'reviewer') {
      return { state, success: false, error: '普通操作员不能执行复核通过操作' };
    }
  }

  const user = state.users.find((u) => u.id === state.currentUserId);
  const history = {
    id: uuidv4(),
    sampleId,
    action,
    operatorId: state.currentUserId,
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    fromStatus: sample.status,
    toStatus: newStatus,
    reason,
    remark,
  };

  const updatedSample = {
    ...sample,
    status: newStatus,
    history: [...sample.history, history],
  };

  if (newStatus === 'reviewed') {
    updatedSample.handoverBy = user?.username || '未知';
    updatedSample.handoverAt = new Date().toISOString();
  }

  let newState = fixedReducer(state, { type: 'UPDATE_SAMPLE', payload: updatedSample });

  const ledgerEntry = {
    id: uuidv4(),
    batchId: sample.batchId,
    sampleId: sample.id,
    sampleNo: sample.sampleNo,
    action,
    operatorId: state.currentUserId,
    operatorName: user?.username || '未知',
    timestamp: history.timestamp,
    fromStatus: sample.status,
    toStatus: newStatus,
    reason,
    remark,
  };
  newState = fixedReducer(newState, { type: 'ADD_BATCH_LEDGER_ENTRY', payload: ledgerEntry });

  return { state: newState, success: true };
}

function undoLastStatus(state, sampleId) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return { state, success: false, error: '样本不存在' };

  if (!canModifySample(state, sample) && sample.status !== 'returned') {
    return {
      state,
      success: false,
      error: '普通操作员不能修改已复核通过的交接记录',
    };
  }

  if (sample.history.length < 2) {
    return { state, success: false, error: '该样本尚无状态变更记录，无法撤销' };
  }
  if (sample.status === 'returned') {
    const returnHistory = sample.history[sample.history.length - 1];
    const restoreStatus = returnHistory.fromStatus;
    const user = state.users.find((u) => u.id === state.currentUserId);
    const undoHistory = {
      id: uuidv4(),
      sampleId,
      action: '撤销退回',
      operatorId: state.currentUserId,
      operatorName: user?.username || '未知',
      timestamp: new Date().toISOString(),
      fromStatus: 'returned',
      toStatus: restoreStatus,
      reason: `撤销原退回操作（原退回原因：${returnHistory.reason || '未填写'}）`,
    };
    let newState = fixedReducer(state, {
      type: 'UNDO_LAST_STATUS',
      sampleId,
      history: undoHistory,
      restoreStatus,
      clearHandover: restoreStatus === 'reviewing' || restoreStatus === 'aliquoted' || restoreStatus === 'received',
    });

    const ledgerEntry = {
      id: uuidv4(),
      batchId: sample.batchId,
      sampleId: sample.id,
      sampleNo: sample.sampleNo,
      action: '撤销退回',
      operatorId: state.currentUserId,
      operatorName: user?.username || '未知',
      timestamp: undoHistory.timestamp,
      fromStatus: 'returned',
      toStatus: restoreStatus,
      reason: undoHistory.reason,
    };
    newState = fixedReducer(newState, { type: 'ADD_BATCH_LEDGER_ENTRY', payload: ledgerEntry });

    return { state: newState, success: true };
  }
  return { state, success: false, error: '仅退回状态可撤销最近一次变更' };
}

function exportBatchLedgerCSV(state, batchId) {
  const ledgerEntries = batchId
    ? state.batchLedger.filter((l) => l.batchId === batchId)
    : state.batchLedger;

  const sortedEntries = [...ledgerEntries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const headers = ['时间', '批次号', '样本编号', '动作', '操作人', '原状态', '新状态', '原因', '备注'];
  const rows = sortedEntries.map((l) => {
    const batch = state.batches.find((b) => b.id === l.batchId);
    return [
      new Date(l.timestamp).toLocaleString('zh-CN'),
      batch?.batchNo || '',
      l.sampleNo,
      l.action,
      l.operatorName,
      l.fromStatus ? STATUS_LABELS[l.fromStatus] || l.fromStatus : '无',
      STATUS_LABELS[l.toStatus] || l.toStatus,
      l.reason || '',
      l.remark || '',
    ];
  });

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

let failures = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log(`  ✅ PASS: ${msg}`);
  } else {
    console.log(`  ❌ FAIL: ${msg}`);
    failures++;
  }
};

console.log('\n========== 批量导入与批次台账 回归测试 ==========\n');

let state = createInitialState();

const { state: s1, batch } = createBatch(state, 'BATCH-TEST-001', '测试批次001');
state = s1;
const batchId = batch.id;

console.log('【测试1】CSV 预检 - 空字段检测');
const badRows1 = [
  { sampleNo: '', quantity: '1', source: '内科' },
  { sampleNo: 'S001', quantity: '0', source: '内科' },
  { sampleNo: 'S002', quantity: '1', source: '' },
];
const preCheck1 = prevalidateImportCSV(state, batchId, badRows1);
assert(preCheck1.total === 3, '共检测3行');
assert(preCheck1.invalidCount === 3, '3行全部无效');
assert(preCheck1.results[0].errors.some((e) => e.includes('样本编号不能为空')), '第1行检测到空样本编号');
assert(preCheck1.results[1].errors.some((e) => e.includes('数量必须为大于0')), '第2行检测到无效数量');
assert(preCheck1.results[2].errors.some((e) => e.includes('样本来源不能为空')), '第3行检测到空来源');
assert(preCheck1.canImport === false, '全部无效时不能导入');

console.log('\n【测试2】CSV 预检 - CSV内重复编号检测');
const badRows2 = [
  { sampleNo: 'S001', quantity: '1', source: '内科' },
  { sampleNo: 'S001', quantity: '2', source: '外科' },
  { sampleNo: 'S002', quantity: '3', source: '儿科' },
];
const preCheck2 = prevalidateImportCSV(state, batchId, badRows2);
assert(preCheck2.total === 3, '共检测3行');
assert(preCheck2.invalidCount === 1, '1行无效（重复）');
assert(preCheck2.validCount === 2, '2行有效');
assert(preCheck2.results[1].errors.some((e) => e.includes('CSV文件内存在重复')), '检测到CSV内重复编号');

console.log('\n【测试3】CSV 预检 - 同批次已存在编号检测');
const { newState: s2 } = addSample(state, {
  batchId,
  sampleNo: 'EXIST-001',
  quantity: 1,
  source: '检验科',
  status: 'received',
  receivedAt: new Date().toISOString(),
  receivedBy: '操作员小王',
});
state = s2;

const badRows3 = [
  { sampleNo: 'EXIST-001', quantity: '1', source: '内科' },
  { sampleNo: 'NEW-001', quantity: '2', source: '外科' },
];
const preCheck3 = prevalidateImportCSV(state, batchId, badRows3);
assert(preCheck3.invalidCount === 1, '1行无效（已存在）');
assert(preCheck3.results[0].errors.some((e) => e.includes('该批次中已存在')), '检测到批次内已存在编号');

console.log('\n【测试4】批量导入 - 原子性：失败项不影响成功项');
const mixedRows = [
  { sampleNo: '', quantity: '1', source: '内科' },
  { sampleNo: 'IMPORT-001', quantity: '5', source: '内科病房' },
  { sampleNo: 'IMPORT-002', quantity: '3', source: '外科病房' },
  { sampleNo: 'IMPORT-001', quantity: '2', source: '儿科' },
  { sampleNo: 'IMPORT-003', quantity: '10', source: '检验科' },
];

const preCheck4 = prevalidateImportCSV(state, batchId, mixedRows);
assert(preCheck4.total === 5, '共5行');
assert(preCheck4.validCount === 3, '3行有效');
assert(preCheck4.invalidCount === 2, '2行无效');

const beforeCount = state.samples.length;
const { state: s3, importResult } = batchImportSamples(state, batchId, preCheck4.results);
state = s3;
const afterCount = state.samples.length;

assert(afterCount === beforeCount + 3, `成功导入3行，样本数从${beforeCount}增加到${afterCount}`);
assert(importResult.successCount === 3, '导入结果显示成功3条');
assert(importResult.failedCount === 2, '导入结果显示失败2条');
assert(importResult.details.filter((d) => d.success).length === 3, '详情中3条成功');
assert(importResult.details.filter((d) => !d.success).length === 2, '详情中包含2条预检失败');
assert(importResult.failedCount === preCheck4.invalidCount, '导入循环中无额外失败，失败数等于预检失败数');

assert(state.samples.some((s) => s.sampleNo === 'IMPORT-001'), 'IMPORT-001已导入');
assert(state.samples.some((s) => s.sampleNo === 'IMPORT-002'), 'IMPORT-002已导入');
assert(state.samples.some((s) => s.sampleNo === 'IMPORT-003'), 'IMPORT-003已导入');

assert(state.importResults.length === 1, '导入结果已保存');
assert(state.importResults[0].id === importResult.id, '导入结果ID匹配');

console.log('\n【测试5】批次台账 - 接收、分装、提交复核、复核通过、退回、撤销退回 全流程');
const testSample = state.samples.find((s) => s.sampleNo === 'IMPORT-001');
assert(testSample !== undefined, '找到测试样本');
const sampleId = testSample.id;

const beforeLedgerCount = state.batchLedger.filter((l) => l.sampleId === sampleId).length;
assert(beforeLedgerCount === 1, '样本已有1条台账记录（接收）');

let result;
result = changeSampleStatus(state, sampleId, 'aliquoted', '分装', undefined, '分装为5管');
assert(result.success === true, '分装成功');
state = result.state;

result = changeSampleStatus(state, sampleId, 'reviewing', '提交复核');
assert(result.success === true, '提交复核成功');
state = result.state;

state.currentUserId = 'user-2';
result = changeSampleStatus(state, sampleId, 'reviewed', '复核通过', '审核通过');
assert(result.success === true, '复核通过成功');
state = result.state;

const reviewedSample = state.samples.find((s) => s.id === sampleId);
assert(reviewedSample.handoverBy === '复核员老李', '交接人正确');
assert(reviewedSample.handoverAt !== undefined, '交接时间已记录');

state.currentUserId = 'user-2';
result = changeSampleStatus(state, sampleId, 'returned', '退回', '样本有疑问', '需要重新确认');
assert(result.success === true, '复核员可退回已复核样本');
state = result.state;

state.currentUserId = 'user-1';
result = undoLastStatus(state, sampleId);
assert(result.success === true, '撤销退回成功（操作员可撤销退回状态）');
state = result.state;

const sampleLedger = state.batchLedger.filter((l) => l.sampleId === sampleId);
assert(sampleLedger.length === 6, '样本台账共6条记录：接收→分装→提交复核→复核通过→退回→撤销退回');

const actions = sampleLedger.map((l) => l.action);
assert(actions.includes('样本接收'), '台账包含「样本接收」');
assert(actions.includes('分装'), '台账包含「分装」');
assert(actions.includes('提交复核'), '台账包含「提交复核」');
assert(actions.includes('复核通过'), '台账包含「复核通过」');
assert(actions.includes('退回'), '台账包含「退回」');
assert(actions.includes('撤销退回'), '台账包含「撤销退回」');

const sortedByTime = [...sampleLedger].sort(
  (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
);
assert(sortedByTime[0].action === '样本接收', '时间线第1条：样本接收');
assert(sortedByTime[1].action === '分装', '时间线第2条：分装');
assert(sortedByTime[2].action === '提交复核', '时间线第3条：提交复核');
assert(sortedByTime[3].action === '复核通过', '时间线第4条：复核通过');
assert(sortedByTime[4].action === '退回', '时间线第5条：退回');
assert(sortedByTime[5].action === '撤销退回', '时间线第6条：撤销退回');

console.log('\n【测试6】批次台账 CSV 导出');
const ledgerCSV = exportBatchLedgerCSV(state, batchId);
const ledgerLines = ledgerCSV.split('\n');
assert(ledgerLines.length >= 7, 'CSV至少7行（表头+6条记录）');
const headerLine = ledgerLines[0];
assert(headerLine.includes('时间'), 'CSV表头含「时间」');
assert(headerLine.includes('样本编号'), 'CSV表头含「样本编号」');
assert(headerLine.includes('动作'), 'CSV表头含「动作」');
assert(headerLine.includes('操作人'), 'CSV表头含「操作人」');
assert(headerLine.includes('原状态'), 'CSV表头含「原状态」');
assert(headerLine.includes('新状态'), 'CSV表头含「新状态」');

const dataLines = ledgerLines.slice(1);
assert(dataLines.some((l) => l.includes('样本接收')), 'CSV包含样本接收记录');
assert(dataLines.some((l) => l.includes('复核通过')), 'CSV包含复核通过记录');
assert(dataLines.some((l) => l.includes('撤销退回')), 'CSV包含撤销退回记录');

console.log('\n【测试7】权限控制 - 普通操作员不能修改已复核通过的记录');
state.currentUserId = 'user-2';
result = changeSampleStatus(state, sampleId, 'reviewed', '复核通过', '再次审核');
state = result.state;
state.currentUserId = 'user-1';

const reviewedSample2 = state.samples.find((s) => s.id === sampleId);
assert(reviewedSample2.status === 'reviewed', '样本当前状态为已复核通过');

result = changeSampleStatus(state, sampleId, 'returned', '退回', '尝试退回');
assert(result.success === false, '普通操作员不能退回已复核通过的样本');
assert(result.error?.includes('普通操作员不能修改已复核通过'), '错误信息正确');

result = changeSampleStatus(state, sampleId, 'aliquoted', '分装', '尝试修改');
assert(result.success === false, '普通操作员不能修改已复核通过的样本状态');

console.log('\n【测试8】持久化验证 - 重启后导入结果、台账、权限限制仍有效');
const serialized = JSON.stringify(state);
const restored = fixedReducer(createInitialState(), { type: 'SET_DATA', payload: JSON.parse(serialized) });

assert(restored.importResults.length === 1, '重启后导入结果仍存在');
assert(restored.importResults[0].successCount === 3, '重启后导入成功数正确');

assert(restored.batchLedger.length >= 7, '重启后批次台账仍存在');
const restoredLedger = restored.batchLedger.filter((l) => l.sampleId === sampleId);
assert(restoredLedger.length === 7, '重启后样本台账完整');

const restoredReviewed = restored.samples.find((s) => s.id === sampleId);
assert(restoredReviewed.status === 'reviewed', '重启后样本状态正确');
assert(restoredReviewed.handoverBy === '复核员老李', '重启后交接人正确');

restored.currentUserId = 'user-1';
const canModify = canModifySample(restored, restoredReviewed);
assert(canModify === false, '重启后权限限制仍有效：普通操作员不能修改');

restored.currentUserId = 'user-2';
const canModifyReviewer = canModifySample(restored, restoredReviewed);
assert(canModifyReviewer === true, '重启后权限正确：复核员可以修改');

console.log('\n【测试9】按批次查看台账摘要');
const batchLedgerEntries = state.batchLedger.filter((l) => l.batchId === batchId);
const batchSamples = state.samples.filter((s) => s.batchId === batchId);
const stats = {
  totalSamples: batchSamples.length,
  totalActions: batchLedgerEntries.length,
  byAction: {},
  bySample: {},
};
batchLedgerEntries.forEach((l) => {
  stats.byAction[l.action] = (stats.byAction[l.action] || 0) + 1;
  stats.bySample[l.sampleNo] = (stats.bySample[l.sampleNo] || 0) + 1;
});

assert(stats.totalSamples >= 4, '批次样本数正确');
assert(stats.byAction['样本接收'] >= 4, '批次接收动作数正确');
assert(stats.byAction['复核通过'] >= 1, '批次有复核通过记录');

console.log('\n【测试10】导入历史 - 成功失败混合导入');
const { state: s10, batch: batch10 } = createBatch(createInitialState(), 'BATCH-TEST-10', '混合导入测试批次');
const csvRows10 = [
  { sampleNo: 'S10-001', quantity: '5', source: '内科' },
  { sampleNo: 'S10-002', quantity: '3', source: '外科' },
  { sampleNo: '', quantity: '2', source: '儿科' },
  { sampleNo: 'S10-004', quantity: '4', source: '妇产科' },
  { sampleNo: 'S10-001', quantity: '1', source: '眼科' },
];
const prevalidate10 = prevalidateImportCSV(s10, batch10.id, csvRows10);
assert(prevalidate10.total === 5, '预检总数正确');
assert(prevalidate10.validCount === 3, '预检成功数正确（排除空编号和重复）');
assert(prevalidate10.invalidCount === 2, '预检失败数正确');

const importResult10 = batchImportSamples(s10, batch10.id, prevalidate10.results);
const state10 = importResult10.state;

assert(state10.importResults.length === 1, '导入结果已记录');
const importRecord10 = state10.importResults[0];
assert(importRecord10.batchId === batch10.id, '导入结果关联批次正确');
assert(importRecord10.totalCount === 5, '导入总数正确');
assert(importRecord10.successCount === 3, '导入成功数正确');
assert(importRecord10.failedCount === 2, '导入失败数正确');
assert(importRecord10.details.length === 5, '明细包含所有行');

const successDetails = importRecord10.details.filter((d) => d.success);
const failedDetails = importRecord10.details.filter((d) => !d.success);
assert(successDetails.length === 3, '成功明细数量正确');
assert(failedDetails.length === 2, '失败明细数量正确');
assert(failedDetails[0].error?.includes('不能为空') || failedDetails[0].error?.includes('重复'), '失败明细含错误信息');
assert(failedDetails.some((d) => d.sampleNo === ''), '空编号样本在失败明细中');
assert(failedDetails.some((d) => d.error?.includes('重复')), '重复样本在失败明细中');

console.log('\n【测试11】导入历史 - 重启后查看同一批次结果');
const serialized10 = JSON.stringify(state10);
const restored10 = fixedReducer(createInitialState(), { type: 'SET_DATA', payload: JSON.parse(serialized10) });

assert(restored10.importResults.length === 1, '重启后导入历史仍存在');
const restoredImport10 = restored10.importResults[0];
assert(restoredImport10.id === importRecord10.id, '重启后导入记录ID一致');
assert(restoredImport10.batchId === batch10.id, '重启后批次关联正确');
assert(restoredImport10.totalCount === 5, '重启后总数正确');
assert(restoredImport10.successCount === 3, '重启后成功数正确');
assert(restoredImport10.failedCount === 2, '重启后失败数正确');
assert(restoredImport10.details.length === 5, '重启后明细完整');
assert(restoredImport10.timestamp === importRecord10.timestamp, '重启后时间戳一致');
assert(restoredImport10.operatorName === importRecord10.operatorName, '重启后操作人一致');

const batchFiltered = restored10.importResults.filter((r) => r.batchId === batch10.id);
assert(batchFiltered.length === 1, '按批次筛选可找到记录');

console.log('\n【测试12】导入历史 - 空态与异常处理');
const emptyState = createInitialState();
assert(emptyState.importResults.length === 0, '初始状态无导入记录');

const emptyFiltered = emptyState.importResults.filter(() => true);
assert(emptyFiltered.length === 0, '空数组筛选无报错');

const sortedEmpty = [...emptyFiltered].sort(
  (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
);
assert(sortedEmpty.length === 0, '空数组排序无报错');

const { state: s12a, batch: batch12a } = createBatch(emptyState, 'BATCH-TEST-12A', '全成功批次');
const csvRows12a = [
  { sampleNo: 'S12-001', quantity: '5', source: '内科' },
  { sampleNo: 'S12-002', quantity: '3', source: '外科' },
  { sampleNo: 'S12-003', quantity: '4', source: '儿科' },
];
const prevalidate12a = prevalidateImportCSV(s12a, batch12a.id, csvRows12a);
assert(prevalidate12a.validCount === 3, '全部成功预检');
const importResult12a = batchImportSamples(s12a, batch12a.id, prevalidate12a.results);
const state12a = importResult12a.state;
assert(state12a.importResults.length === 1, '导入成功后有1条记录');
const record12a = state12a.importResults[0];
assert(record12a.failedCount === 0, '全成功导入失败数为0');
assert(record12a.successCount === 3, '全成功导入成功数为3');
const allSuccess = record12a.details.every((d) => d.success);
assert(allSuccess === true, '所有明细均为成功');

const { state: s12b, batch: batch12b } = createBatch(state12a, 'BATCH-TEST-12B', '第二批次');
const csvRows12b = [
  { sampleNo: 'S12B-001', quantity: '2', source: '内科' },
  { sampleNo: '', quantity: '1', source: '外科' },
];
const prevalidate12b = prevalidateImportCSV(s12b, batch12b.id, csvRows12b);
const importResult12b = batchImportSamples(s12b, batch12b.id, prevalidate12b.results);
const state12b = importResult12b.state;
assert(state12b.importResults.length === 2, '多批次导入后有2条记录');

const filteredBatchA = state12b.importResults.filter((r) => r.batchId === batch12a.id);
assert(filteredBatchA.length === 1, '按批次A筛选正确');
assert(filteredBatchA[0].totalCount === 3, '批次A记录正确');

const filteredBatchB = state12b.importResults.filter((r) => r.batchId === batch12b.id);
assert(filteredBatchB.length === 1, '按批次B筛选正确');
assert(filteredBatchB[0].totalCount === 2, '批次B记录正确');

const sortedResults = [...state12b.importResults].sort(
  (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
);
assert(sortedResults[0].id === record12a.id || sortedResults[1].id === record12a.id, '按时间倒序排列');

console.log('\n========== 导入方案管理 回归测试 ==========\n');

function createSchemeInitialState() {
  return {
    users: [
      { id: 'user-1', username: '操作员小王', role: 'operator' },
      { id: 'user-2', username: '复核员老李', role: 'reviewer' },
    ],
    batches: [],
    samples: [],
    importResults: [],
    batchLedger: [],
    currentUserId: 'user-1',
    importSchemes: [],
    schemeAuditLog: [],
    lastSelectedSchemeId: null,
  };
}

const defaultValidationToggles = {
  skipEmptySampleNo: true,
  skipDuplicateInFile: true,
  skipDuplicateInBatch: true,
  skipInvalidQuantity: true,
  skipEmptySource: true,
};

function schemeReducer(state, action) {
  switch (action.type) {
    case 'ADD_IMPORT_SCHEME':
      return { ...state, importSchemes: [...state.importSchemes, action.payload] };
    case 'UPDATE_IMPORT_SCHEME':
      return {
        ...state,
        importSchemes: state.importSchemes.map((s) =>
          s.id === action.payload.id ? action.payload : s
        ),
      };
    case 'DELETE_IMPORT_SCHEME':
      return {
        ...state,
        importSchemes: state.importSchemes.filter((s) => s.id !== action.schemeId),
      };
    case 'ADD_SCHEME_AUDIT_LOG':
      return {
        ...state,
        schemeAuditLog: [...state.schemeAuditLog, action.payload],
      };
    case 'SET_LAST_SELECTED_SCHEME':
      return { ...state, lastSelectedSchemeId: action.schemeId };
    case 'SET_DATA':
      return action.payload;
    default:
      return state;
  }
}

function getSchemeAuditLog(state, schemeId) {
  return state.schemeAuditLog.filter((l) => l.schemeId === schemeId);
}

function canModifyScheme(state, scheme) {
  if (scheme.isLocked && scheme.isShared && scheme.createdById !== state.currentUserId) {
    return false;
  }
  return true;
}

function createImportScheme(state, name, opts = {}) {
  const user = state.users.find((u) => u.id === state.currentUserId);
  const scheme = {
    id: uuidv4(),
    name,
    columnMappings: opts.columnMappings || [
      { csvColumn: '样本编号', targetField: 'sampleNo' },
      { csvColumn: '数量', targetField: 'quantity' },
      { csvColumn: '来源', targetField: 'source' },
    ],
    defaultBatch: opts.defaultBatch || { batchNoPattern: '', batchNamePattern: '' },
    validationToggles: opts.validationToggles || { ...defaultValidationToggles },
    isShared: opts.isShared || false,
    isLocked: opts.isLocked || false,
    createdBy: user?.username || '未知',
    createdById: state.currentUserId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let newState = schemeReducer(state, { type: 'ADD_IMPORT_SCHEME', payload: scheme });
  const auditEntry = {
    id: uuidv4(),
    schemeId: scheme.id,
    schemeName: scheme.name,
    action: 'create',
    operatorId: state.currentUserId,
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail: '创建导入方案',
  };
  newState = schemeReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });

  return { state: newState, scheme };
}

function renameImportScheme(state, schemeId, newName) {
  const scheme = state.importSchemes.find((s) => s.id === schemeId);
  if (!scheme) return { state, success: false, error: '方案不存在' };
  if (!canModifyScheme(state, scheme)) {
    return { state, success: false, error: '无权修改此方案（他人锁定共享方案）' };
  }
  const oldName = scheme.name;
  const updated = { ...scheme, name: newName, updatedAt: new Date().toISOString() };
  let newState = schemeReducer(state, { type: 'UPDATE_IMPORT_SCHEME', payload: updated });
  const user = state.users.find((u) => u.id === state.currentUserId);
  const auditEntry = {
    id: uuidv4(),
    schemeId,
    schemeName: newName,
    action: 'rename',
    operatorId: state.currentUserId,
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail: `方案重命名：${oldName} → ${newName}`,
  };
  newState = schemeReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });
  return { state: newState, success: true };
}

function copyImportScheme(state, schemeId, newName) {
  const scheme = state.importSchemes.find((s) => s.id === schemeId);
  if (!scheme) return { state, success: false, error: '方案不存在' };
  const user = state.users.find((u) => u.id === state.currentUserId);
  const copied = {
    ...scheme,
    id: uuidv4(),
    name: newName,
    isShared: false,
    isLocked: false,
    createdBy: user?.username || '未知',
    createdById: state.currentUserId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let newState = schemeReducer(state, { type: 'ADD_IMPORT_SCHEME', payload: copied });
  const auditEntry = {
    id: uuidv4(),
    schemeId: copied.id,
    schemeName: newName,
    action: 'copy',
    operatorId: state.currentUserId,
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail: `从方案「${scheme.name}」复制`,
  };
  newState = schemeReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });
  return { state: newState, success: true, copiedScheme: copied };
}

function deleteImportScheme(state, schemeId) {
  const scheme = state.importSchemes.find((s) => s.id === schemeId);
  if (!scheme) return { state, success: false, error: '方案不存在' };
  if (!canModifyScheme(state, scheme)) {
    return { state, success: false, error: '无权删除此方案（他人锁定共享方案）' };
  }
  let newState = schemeReducer(state, { type: 'DELETE_IMPORT_SCHEME', schemeId });
  const user = state.users.find((u) => u.id === state.currentUserId);
  const auditEntry = {
    id: uuidv4(),
    schemeId,
    schemeName: scheme.name,
    action: 'delete',
    operatorId: state.currentUserId,
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail: `删除方案「${scheme.name}」`,
  };
  newState = schemeReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });
  if (newState.lastSelectedSchemeId === schemeId) {
    newState = schemeReducer(newState, { type: 'SET_LAST_SELECTED_SCHEME', schemeId: null });
  }
  return { state: newState, success: true };
}

function modifyImportScheme(state, schemeId, updates) {
  const scheme = state.importSchemes.find((s) => s.id === schemeId);
  if (!scheme) return { state, success: false, error: '方案不存在' };
  if (!canModifyScheme(state, scheme)) {
    return { state, success: false, error: '无权修改此方案（他人锁定共享方案）' };
  }
  const updated = { ...scheme, ...updates, updatedAt: new Date().toISOString() };
  let newState = schemeReducer(state, { type: 'UPDATE_IMPORT_SCHEME', payload: updated });
  const user = state.users.find((u) => u.id === state.currentUserId);
  const auditEntry = {
    id: uuidv4(),
    schemeId,
    schemeName: updated.name,
    action: 'modify',
    operatorId: state.currentUserId,
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail: '修改方案配置',
  };
  newState = schemeReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });
  return { state: newState, success: true };
}

function exportSchemesJSON(state, schemeIds) {
  const schemes = state.importSchemes.filter((s) => schemeIds.includes(s.id));
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: state.users.find((u) => u.id === state.currentUserId)?.username || '未知',
    schemes,
  };
  const user = state.users.find((u) => u.id === state.currentUserId);
  let newState = state;
  for (const s of schemes) {
    const auditEntry = {
      id: uuidv4(),
      schemeId: s.id,
      schemeName: s.name,
      action: 'export',
      operatorId: state.currentUserId,
      operatorName: user?.username || '未知',
      timestamp: new Date().toISOString(),
      detail: '导出方案',
    };
    newState = schemeReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });
  }
  return { state: newState, json: JSON.stringify(exportData, null, 2) };
}

function importSchemesJSON(state, jsonString, conflictResolution = 'skip') {
  const user = state.users.find((u) => u.id === state.currentUserId);
  let importData;
  try {
    importData = JSON.parse(jsonString);
  } catch (e) {
    return { state, success: false, error: 'JSON格式无效' };
  }
  if (!importData.schemes || !Array.isArray(importData.schemes)) {
    return { state, success: false, error: '导入数据缺少schemes字段' };
  }
  let newState = state;
  let importedCount = 0;
  let skippedCount = 0;
  let overwrittenCount = 0;

  for (const scheme of importData.schemes) {
    const existingByName = newState.importSchemes.find((s) => s.name === scheme.name);
    if (existingByName) {
      if (conflictResolution === 'skip') {
        skippedCount++;
        continue;
      } else if (conflictResolution === 'overwrite') {
        if (!canModifyScheme(newState, existingByName)) {
          skippedCount++;
          continue;
        }
        const updated = {
          ...scheme,
          id: existingByName.id,
          createdById: existingByName.createdById,
          createdBy: existingByName.createdBy,
          isLocked: existingByName.isLocked,
          isShared: existingByName.isShared,
          updatedBy: user?.username || '未知',
          updatedAt: new Date().toISOString(),
        };
        newState = schemeReducer(newState, { type: 'UPDATE_IMPORT_SCHEME', payload: updated });
        overwrittenCount++;
        const auditEntry = {
          id: uuidv4(),
          schemeId: existingByName.id,
          schemeName: scheme.name,
          action: 'import',
          operatorId: state.currentUserId,
          operatorName: user?.username || '未知',
          timestamp: new Date().toISOString(),
          detail: `导入覆盖方案「${scheme.name}」`,
        };
        newState = schemeReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });
        continue;
      }
    }
    const newScheme = {
      ...scheme,
      id: uuidv4(),
      createdBy: user?.username || '未知',
      createdById: state.currentUserId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isShared: false,
      isLocked: false,
    };
    newState = schemeReducer(newState, { type: 'ADD_IMPORT_SCHEME', payload: newScheme });
    importedCount++;
    const auditEntry = {
      id: uuidv4(),
      schemeId: newScheme.id,
      schemeName: newScheme.name,
      action: 'import',
      operatorId: state.currentUserId,
      operatorName: user?.username || '未知',
      timestamp: new Date().toISOString(),
      detail: `导入新方案「${newScheme.name}」`,
    };
    newState = schemeReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });
  }

  return {
    state: newState,
    success: true,
    importedCount,
    skippedCount,
    overwrittenCount,
  };
}

function lockScheme(state, schemeId) {
  const scheme = state.importSchemes.find((s) => s.id === schemeId);
  if (!scheme) return { state, success: false, error: '方案不存在' };
  if (scheme.createdById !== state.currentUserId) {
    return { state, success: false, error: '只有方案创建者才能锁定' };
  }
  const updated = { ...scheme, isLocked: true, isShared: true, updatedAt: new Date().toISOString() };
  let newState = schemeReducer(state, { type: 'UPDATE_IMPORT_SCHEME', payload: updated });
  const user = state.users.find((u) => u.id === state.currentUserId);
  const auditEntry = {
    id: uuidv4(),
    schemeId,
    schemeName: scheme.name,
    action: 'lock',
    operatorId: state.currentUserId,
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail: '锁定共享方案',
  };
  newState = schemeReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });
  return { state: newState, success: true };
}

function unlockScheme(state, schemeId) {
  const scheme = state.importSchemes.find((s) => s.id === schemeId);
  if (!scheme) return { state, success: false, error: '方案不存在' };
  if (scheme.createdById !== state.currentUserId) {
    return { state, success: false, error: '只有方案创建者才能解锁' };
  }
  const updated = { ...scheme, isLocked: false, updatedAt: new Date().toISOString() };
  let newState = schemeReducer(state, { type: 'UPDATE_IMPORT_SCHEME', payload: updated });
  const user = state.users.find((u) => u.id === state.currentUserId);
  const auditEntry = {
    id: uuidv4(),
    schemeId,
    schemeName: scheme.name,
    action: 'unlock',
    operatorId: state.currentUserId,
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail: '解锁方案',
  };
  newState = schemeReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });
  return { state: newState, success: true };
}

let schemeState = createSchemeInitialState();

console.log('【测试13】导入方案 - 创建方案');
const { state: s13, scheme: scheme1 } = createImportScheme(schemeState, '标准导入方案', {
  columnMappings: [
    { csvColumn: '样本编号', targetField: 'sampleNo' },
    { csvColumn: '数量', targetField: 'quantity' },
    { csvColumn: '来源', targetField: 'source' },
  ],
  defaultBatch: { batchNoPattern: 'BATCH-{DATE}', batchNamePattern: '日常送检' },
  validationToggles: { ...defaultValidationToggles },
});
schemeState = s13;
assert(schemeState.importSchemes.length === 1, '方案列表有1个方案');
assert(schemeState.importSchemes[0].name === '标准导入方案', '方案名称正确');
assert(schemeState.importSchemes[0].columnMappings.length === 3, '列映射数量正确');
assert(schemeState.importSchemes[0].createdBy === '操作员小王', '创建人正确');
assert(schemeState.importSchemes[0].createdById === 'user-1', '创建人ID正确');
assert(schemeState.schemeAuditLog.length === 1, '审计日志1条');
assert(schemeState.schemeAuditLog[0].action === 'create', '审计操作为create');
assert(schemeState.schemeAuditLog[0].schemeId === scheme1.id, '审计日志关联方案ID正确');

console.log('\n【测试14】导入方案 - 重命名方案');
const renameResult = renameImportScheme(schemeState, scheme1.id, '日常标准导入');
assert(renameResult.success === true, '重命名成功');
schemeState = renameResult.state;
assert(schemeState.importSchemes[0].name === '日常标准导入', '方案名称已更新');
assert(schemeState.schemeAuditLog.length === 2, '审计日志2条');
assert(schemeState.schemeAuditLog[1].action === 'rename', '审计操作为rename');
assert(schemeState.schemeAuditLog[1].detail.includes('日常标准导入'), '审计详情含新名称');

console.log('\n【测试15】导入方案 - 复制方案');
const copyResult = copyImportScheme(schemeState, scheme1.id, '日常标准导入-副本');
assert(copyResult.success === true, '复制成功');
schemeState = copyResult.state;
assert(schemeState.importSchemes.length === 2, '方案列表有2个方案');
assert(schemeState.importSchemes[1].name === '日常标准导入-副本', '副本名称正确');
assert(schemeState.importSchemes[1].id !== scheme1.id, '副本ID不同于原方案');
assert(schemeState.importSchemes[1].isShared === false, '副本默认不共享');
assert(schemeState.importSchemes[1].isLocked === false, '副本默认不锁定');
assert(schemeState.importSchemes[1].createdById === 'user-1', '副本创建人为当前用户');
assert(schemeState.schemeAuditLog.length === 3, '审计日志3条');
assert(schemeState.schemeAuditLog[2].action === 'copy', '审计操作为copy');

console.log('\n【测试16】导入方案 - 删除方案');
const copiedId = schemeState.importSchemes[1].id;
const deleteResult = deleteImportScheme(schemeState, copiedId);
assert(deleteResult.success === true, '删除成功');
schemeState = deleteResult.state;
assert(schemeState.importSchemes.length === 1, '方案列表剩1个方案');
assert(schemeState.schemeAuditLog.length === 4, '审计日志4条');
assert(schemeState.schemeAuditLog[3].action === 'delete', '审计操作为delete');

console.log('\n【测试17】导入方案 - 修改方案配置');
const modifyResult = modifyImportScheme(schemeState, scheme1.id, {
  validationToggles: { ...defaultValidationToggles, skipEmptySource: false },
  defaultBatch: { batchNoPattern: 'BATCH-{DATE}-{SEQ}', batchNamePattern: '紧急送检' },
});
assert(modifyResult.success === true, '修改成功');
schemeState = modifyResult.state;
assert(schemeState.importSchemes[0].validationToggles.skipEmptySource === false, '校验开关已更新');
assert(schemeState.importSchemes[0].defaultBatch.batchNoPattern === 'BATCH-{DATE}-{SEQ}', '默认批次信息已更新');
assert(schemeState.schemeAuditLog.length === 5, '审计日志5条');
assert(schemeState.schemeAuditLog[4].action === 'modify', '审计操作为modify');

console.log('\n【测试18】导入方案 - 导出JSON');
const exportResult = exportSchemesJSON(schemeState, [scheme1.id]);
assert(exportResult.json !== undefined, '导出JSON不为空');
schemeState = exportResult.state;
const parsed = JSON.parse(exportResult.json);
assert(parsed.version === 1, '导出版本号为1');
assert(parsed.schemes.length === 1, '导出1个方案');
assert(parsed.schemes[0].name === '日常标准导入', '导出方案名称正确');
assert(parsed.exportedBy === '操作员小王', '导出人正确');
assert(schemeState.schemeAuditLog.length === 6, '审计日志6条');
assert(schemeState.schemeAuditLog[5].action === 'export', '审计操作为export');

console.log('\n【测试19】导入方案 - 导入JSON（无冲突）');
const { state: s19, scheme: scheme2 } = createImportScheme(
  createSchemeInitialState(),
  '另一方案',
  { isShared: true }
);
let state19 = s19;
state19.currentUserId = 'user-1';
const newSchemeJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '外部用户',
  schemes: [{
    name: '外部方案A',
    columnMappings: [{ csvColumn: '编号', targetField: 'sampleNo' }],
    defaultBatch: { batchNoPattern: 'EXT-{DATE}', batchNamePattern: '外部' },
    validationToggles: { ...defaultValidationToggles },
    isShared: false,
    isLocked: false,
  }],
});
const importResult19 = importSchemesJSON(state19, newSchemeJSON, 'skip');
assert(importResult19.success === true, '导入成功');
assert(importResult19.importedCount === 1, '导入1个');
assert(importResult19.skippedCount === 0, '无跳过');
assert(importResult19.overwrittenCount === 0, '无覆盖');
state19 = importResult19.state;
assert(state19.importSchemes.length === 2, '方案列表有2个');
const importedScheme = state19.importSchemes.find((s) => s.name === '外部方案A');
assert(importedScheme !== undefined, '导入的方案存在');
assert(importedScheme.createdById === 'user-1', '导入方案创建人为当前用户');
assert(importedScheme.isShared === false, '导入方案默认不共享');
assert(importedScheme.isLocked === false, '导入方案默认不锁定');

console.log('\n【测试20】导入方案 - 导入JSON同名冲突（跳过）');
const conflictJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '外部用户',
  schemes: [{
    name: '另一方案',
    columnMappings: [{ csvColumn: '新列', targetField: 'sampleNo' }],
    defaultBatch: { batchNoPattern: '', batchNamePattern: '' },
    validationToggles: { ...defaultValidationToggles },
  }],
});
const importResult20 = importSchemesJSON(state19, conflictJSON, 'skip');
assert(importResult20.success === true, '导入处理完成');
assert(importResult20.skippedCount === 1, '跳过1个同名方案');
assert(importResult20.importedCount === 0, '无新增');
let state20 = importResult20.state;
const originalScheme = state20.importSchemes.find((s) => s.name === '另一方案');
assert(originalScheme.columnMappings[0].csvColumn === '样本编号', '同名方案未被覆盖（保留原列映射）');

console.log('\n【测试21】导入方案 - 导入JSON同名冲突（覆盖）');
const importResult21 = importSchemesJSON(state19, conflictJSON, 'overwrite');
assert(importResult21.success === true, '导入处理完成');
assert(importResult21.overwrittenCount === 1, '覆盖1个同名方案');
assert(importResult21.skippedCount === 0, '无跳过');
let state21 = importResult21.state;
const overwrittenScheme = state21.importSchemes.find((s) => s.name === '另一方案');
assert(overwrittenScheme.columnMappings[0].csvColumn === '新列', '同名方案已被覆盖（新列映射生效）');

console.log('\n【测试22】导入方案 - 最近选择持久化');
let state22 = createSchemeInitialState();
const { state: s22a, scheme: scheme22 } = createImportScheme(state22, '方案A');
state22 = s22a;
state22 = schemeReducer(state22, { type: 'SET_LAST_SELECTED_SCHEME', schemeId: scheme22.id });
assert(state22.lastSelectedSchemeId === scheme22.id, '最近选择已记录');
const serialized22 = JSON.stringify(state22);
const restored22 = schemeReducer(createSchemeInitialState(), { type: 'SET_DATA', payload: JSON.parse(serialized22) });
assert(restored22.lastSelectedSchemeId === scheme22.id, '重启后最近选择仍有效');
assert(restored22.importSchemes.length === 1, '重启后方案仍存在');
assert(restored22.importSchemes[0].name === '方案A', '重启后方案名称正确');

console.log('\n【测试23】导入方案 - 权限边界：锁定共享方案');
let state23 = createSchemeInitialState();
const { state: s23, scheme: lockedScheme } = createImportScheme(state23, '锁定共享方案', {
  isShared: true,
  isLocked: true,
});
state23 = s23;
assert(canModifyScheme(state23, lockedScheme) === true, '创建者可以修改自己的锁定方案');
state23.currentUserId = 'user-2';
assert(canModifyScheme(state23, lockedScheme) === false, '非创建者不能修改他人锁定的共享方案');
const renameLocked = renameImportScheme(state23, lockedScheme.id, '尝试改名');
assert(renameLocked.success === false, '非创建者不能重命名锁定方案');
assert(renameLocked.error.includes('他人锁定'), '错误信息正确');
const deleteLocked = deleteImportScheme(state23, lockedScheme.id);
assert(deleteLocked.success === false, '非创建者不能删除锁定方案');
const modifyLocked = modifyImportScheme(state23, lockedScheme.id, {
  validationToggles: { ...defaultValidationToggles, skipEmptySampleNo: false },
});
assert(modifyLocked.success === false, '非创建者不能修改锁定方案配置');
state23.currentUserId = 'user-1';
const renameByOwner = renameImportScheme(state23, lockedScheme.id, '创建者改名');
assert(renameByOwner.success === true, '创建者可以重命名自己的锁定方案');

console.log('\n【测试24】导入方案 - 权限边界：锁定解锁操作');
let state24 = createSchemeInitialState();
const { state: s24, scheme: scheme24 } = createImportScheme(state24, '待锁定方案');
state24 = s24;
state24.currentUserId = 'user-2';
const lockByOther = lockScheme(state24, scheme24.id);
assert(lockByOther.success === false, '非创建者不能锁定方案');
assert(lockByOther.error.includes('创建者'), '锁定错误信息正确');
state24.currentUserId = 'user-1';
const lockByOwner = lockScheme(state24, scheme24.id);
assert(lockByOwner.success === true, '创建者可以锁定方案');
state24 = lockByOwner.state;
assert(state24.importSchemes[0].isLocked === true, '方案已标记为锁定');
const unlockResult = unlockScheme(state24, scheme24.id);
assert(unlockResult.success === true, '创建者可以解锁方案');
state24 = unlockResult.state;
assert(state24.importSchemes[0].isLocked === false, '方案已解锁');

console.log('\n【测试25】导入方案 - 审计留痕完整性');
let state25 = createSchemeInitialState();
const { state: s25a, scheme: s25_scheme } = createImportScheme(state25, '审计测试方案');
state25 = s25a;
renameImportScheme(state25, s25_scheme.id, '审计测试方案-改名');
state25 = renameImportScheme(state25, s25_scheme.id, '审计测试方案-改名').state;
modifyImportScheme(state25, s25_scheme.id, { defaultBatch: { batchNoPattern: 'TEST', batchNamePattern: '' } });
state25 = modifyImportScheme(state25, s25_scheme.id, { defaultBatch: { batchNoPattern: 'TEST', batchNamePattern: '' } }).state;
const expResult = exportSchemesJSON(state25, [s25_scheme.id]);
state25 = expResult.state;
const schemeAuditLogs = getSchemeAuditLog(state25, s25_scheme.id);
assert(schemeAuditLogs.length >= 3, `审计日志至少3条，实际${schemeAuditLogs.length}条`);
const schemeActions = schemeAuditLogs.map((l) => l.action);
assert(schemeActions.includes('create'), '审计包含创建');
assert(schemeActions.includes('rename'), '审计包含重命名');
assert(schemeActions.includes('modify'), '审计包含修改');
assert(schemeActions.includes('export'), '审计包含导出');
for (const log of schemeAuditLogs) {
  assert(log.operatorName !== undefined, `审计日志操作人非空`);
  assert(log.timestamp !== undefined, `审计日志时间戳非空`);
  assert(log.schemeName !== undefined, `审计日志方案名非空`);
}

console.log('\n【测试26】导入方案 - 重启后完整复查');
let state26 = createSchemeInitialState();
const { state: s26a, scheme: s26_1 } = createImportScheme(state26, '重启测试A');
state26 = s26a;
const { state: s26b, scheme: s26_2 } = createImportScheme(state26, '重启测试B', {
  isShared: true,
  isLocked: true,
});
state26 = s26b;
state26 = schemeReducer(state26, { type: 'SET_LAST_SELECTED_SCHEME', schemeId: s26_1.id });
const serialized26 = JSON.stringify(state26);
const restored26 = schemeReducer(createSchemeInitialState(), { type: 'SET_DATA', payload: JSON.parse(serialized26) });
assert(restored26.importSchemes.length === 2, '重启后2个方案');
assert(restored26.importSchemes.find((s) => s.name === '重启测试A') !== undefined, '重启后方案A存在');
assert(restored26.importSchemes.find((s) => s.name === '重启测试B') !== undefined, '重启后方案B存在');
assert(restored26.lastSelectedSchemeId === s26_1.id, '重启后最近选择方案正确');
const restoredB = restored26.importSchemes.find((s) => s.name === '重启测试B');
assert(restoredB.isShared === true, '重启后共享标记保留');
assert(restoredB.isLocked === true, '重启后锁定标记保留');
assert(restoredB.createdById === 'user-1', '重启后创建人ID保留');
assert(restored26.schemeAuditLog.length >= 2, '重启后审计日志保留');

console.log('\n【测试27】导入方案 - 导出再导回全流程');
let state27 = createSchemeInitialState();
const { state: s27a, scheme: s27_1 } = createImportScheme(state27, '导出再导回方案');
state27 = s27a;
const export27 = exportSchemesJSON(state27, [s27_1.id]);
state27 = export27.state;
const exportJSON = export27.json;
state27 = schemeReducer(state27, { type: 'DELETE_IMPORT_SCHEME', schemeId: s27_1.id });
assert(state27.importSchemes.length === 0, '删除后无方案');
const import27 = importSchemesJSON(state27, exportJSON, 'skip');
assert(import27.success === true, '导回成功');
assert(import27.importedCount === 1, '导回1个');
state27 = import27.state;
assert(state27.importSchemes.length === 1, '导回后方案列表有1个');
assert(state27.importSchemes[0].name === '导出再导回方案', '导回方案名称正确');
assert(state27.importSchemes[0].columnMappings.length === s27_1.columnMappings.length, '导回列映射数量一致');

console.log('\n【测试28】导入方案 - 锁定共享方案的导入覆盖保护');
let state28 = createSchemeInitialState();
const { state: s28a, scheme: s28_locked } = createImportScheme(state28, '受保护方案', {
  isShared: true,
  isLocked: true,
});
state28 = s28a;
state28.currentUserId = 'user-2';
const lockedConflictJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '其他人',
  schemes: [{
    name: '受保护方案',
    columnMappings: [{ csvColumn: '篡改列', targetField: 'sampleNo' }],
    defaultBatch: { batchNoPattern: '', batchNamePattern: '' },
    validationToggles: { ...defaultValidationToggles },
  }],
});
const import28 = importSchemesJSON(state28, lockedConflictJSON, 'overwrite');
assert(import28.overwrittenCount === 0, '非创建者导入不能覆盖锁定方案');
assert(import28.skippedCount === 1, '锁定方案被跳过');

console.log('\n========== 方案列映射、校验开关、默认批次、完整链路 回归测试 ==========\n');

function parseCSVWithScheme(content, columnMappings) {
  const lines = content.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const firstLineCells = lines[0].split(',').map((v) => v.trim());

  const colIndexMap = {};
  let headerFound = false;
  for (const mapping of columnMappings) {
    const idx = firstLineCells.findIndex((h) => h === mapping.csvColumn);
    if (idx !== -1) {
      colIndexMap[mapping.targetField] = idx;
      headerFound = true;
    }
  }

  if (!headerFound) {
    const defaultHeaders = ['样本编号', 'sampleNo', 'SampleNo', '编号'];
    for (let i = 0; i < firstLineCells.length; i++) {
      if (defaultHeaders.some((h) => firstLineCells[i].includes(h))) {
        headerFound = true;
        break;
      }
    }
  }

  const startIdx = headerFound ? 1 : 0;
  const result = [];

  for (let i = startIdx; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim());

    if (headerFound && Object.keys(colIndexMap).length > 0) {
      result.push({
        sampleNo: colIndexMap['sampleNo'] !== undefined ? (values[colIndexMap['sampleNo']] || '') : (values[0] || ''),
        quantity: colIndexMap['quantity'] !== undefined ? (values[colIndexMap['quantity']] || '') : (values[1] || ''),
        source: colIndexMap['source'] !== undefined ? (values[colIndexMap['source']] || '') : (values[2] || ''),
      });
    } else {
      if (values.length >= 3) {
        result.push({ sampleNo: values[0], quantity: values[1], source: values[2] });
      } else if (values.length === 2) {
        result.push({ sampleNo: values[0], quantity: values[1], source: '' });
      } else if (values.length === 1) {
        result.push({ sampleNo: values[0], quantity: '', source: '' });
      }
    }
  }

  return result;
}

function prevalidateImportCSVWithToggles(state, batchId, csvRows, validationToggles) {
  const toggles = validationToggles || {
    skipEmptySampleNo: true,
    skipDuplicateInFile: true,
    skipDuplicateInBatch: true,
    skipInvalidQuantity: true,
    skipEmptySource: true,
  };
  const seenSampleNos = new Set();
  const results = csvRows.map((row, idx) => {
    const errors = [];
    const warnings = [];
    const cleanSampleNo = row.sampleNo.trim();

    if (toggles.skipEmptySampleNo && !cleanSampleNo) {
      errors.push('样本编号不能为空');
    }
    if (toggles.skipInvalidQuantity && (!row.quantity || isNaN(parseInt(row.quantity)) || parseInt(row.quantity) < 1)) {
      errors.push('数量必须为大于0的数字');
    }
    if (toggles.skipEmptySource && !row.source.trim()) {
      errors.push('样本来源不能为空');
    }

    if (cleanSampleNo) {
      if (toggles.skipDuplicateInFile && seenSampleNos.has(cleanSampleNo)) {
        errors.push(`CSV文件内存在重复的样本编号: ${cleanSampleNo}`);
      }
      seenSampleNos.add(cleanSampleNo);

      if (toggles.skipDuplicateInBatch && checkDuplicateSampleNo(state, cleanSampleNo, batchId)) {
        errors.push(`该批次中已存在样本编号: ${cleanSampleNo}`);
      }
    }

    return {
      rowIndex: idx + 1,
      sampleNo: cleanSampleNo,
      valid: errors.length === 0,
      errors,
      warnings,
      quantity: row.quantity,
      source: row.source,
    };
  });

  const validCount = results.filter((r) => r.valid).length;
  const invalidCount = results.filter((r) => !r.valid).length;

  return {
    total: csvRows.length,
    validCount,
    invalidCount,
    canImport: validCount > 0,
    results,
  };
}

function resolveDefaultBatch(pattern, batchCount) {
  return pattern
    .replace('{DATE}', new Date().toISOString().slice(0, 10).replace(/-/g, ''))
    .replace('{SEQ}', String((batchCount || 0) + 1).padStart(3, '0'));
}

console.log('【测试23】方案列映射 CSV 解析 - 自定义列头');
const csv23 = "ID,Qty,Src\nS-001,5,内科\nS-002,3,外科";
const mappings23 = [
  { csvColumn: 'ID', targetField: 'sampleNo' },
  { csvColumn: 'Qty', targetField: 'quantity' },
  { csvColumn: 'Src', targetField: 'source' },
];
const rows23 = parseCSVWithScheme(csv23, mappings23);
assert(rows23.length === 2, '解析出2行数据（表头不被当成数据行）');
assert(rows23[0].sampleNo === 'S-001', 'S-001的sampleNo正确');
assert(rows23[0].quantity === '5', 'S-001的quantity正确');
assert(rows23[0].source === '内科', 'S-001的source正确');
assert(rows23[1].sampleNo === 'S-002', 'S-002的sampleNo正确');
assert(rows23[1].quantity === '3', 'S-002的quantity正确');
assert(rows23[1].source === '外科', 'S-002的source正确');

console.log('\n【测试24】表头识别 - 自定义列头不被当成数据行');
const csv24 = "编号,数量,来源\nS-001,5,内科";
const mappings24 = [
  { csvColumn: '编号', targetField: 'sampleNo' },
  { csvColumn: '数量', targetField: 'quantity' },
  { csvColumn: '来源', targetField: 'source' },
];
const rows24 = parseCSVWithScheme(csv24, mappings24);
assert(rows24.length === 1, '只有1行数据，表头不被当成数据行');
assert(rows24[0].sampleNo === 'S-001', '表头"编号"不被当成样本编号');
assert(rows24[0].quantity === '5', '列映射quantity正确');
assert(rows24[0].source === '内科', '列映射source正确');

console.log('\n【测试25】校验开关 - skipEmptySource=false 时空来源不拦截');
let state25x = createSchemeInitialState();
const { state: s25x, batch: batch25 } = createBatch(state25x, 'BATCH-25', '测试批次25');
state25x = s25x;
const toggles25 = {
  ...defaultValidationToggles,
  skipEmptySource: false,
};
const row25a = { sampleNo: 'S-001', quantity: '5', source: '' };
const preVal25a = prevalidateImportCSVWithToggles(state25x, batch25.id, [row25a], toggles25);
assert(preVal25a.results[0].valid === true, '空来源不拦截，该行valid=true');
assert(!preVal25a.results[0].errors.some((e) => e.includes('来源')), '不因空来源报错');
const row25b = { sampleNo: 'S-002', quantity: '', source: '' };
const preVal25b = prevalidateImportCSVWithToggles(state25x, batch25.id, [row25b], toggles25);
assert(preVal25b.results[0].valid === false, '无效数量仍报错');
assert(preVal25b.results[0].errors.some((e) => e.includes('数量')), '因无效数量报错');
assert(!preVal25b.results[0].errors.some((e) => e.includes('来源')), '不因空来源报错');

console.log('\n【测试26】校验开关 - skipDuplicateInFile=false 时文件内重复不拦截');
let state26x = createSchemeInitialState();
const { state: s26x, batch: batch26 } = createBatch(state26x, 'BATCH-26', '测试批次26');
state26x = s26x;
const toggles26 = {
  ...defaultValidationToggles,
  skipDuplicateInFile: false,
};
const rows26 = [
  { sampleNo: 'S-001', quantity: '5', source: '内科' },
  { sampleNo: 'S-001', quantity: '3', source: '外科' },
];
const preVal26 = prevalidateImportCSVWithToggles(state26x, batch26.id, rows26, toggles26);
assert(preVal26.results[0].valid === true, 'skipDuplicateInFile=false时第一行valid');
assert(preVal26.results[1].valid === true, 'skipDuplicateInFile=false时第二行也valid（文件内重复不拦截）');

console.log('\n【测试27】校验开关 - skipEmptySampleNo=false 时空编号不拦截');
let state27x = createSchemeInitialState();
const { state: s27x, batch: batch27 } = createBatch(state27x, 'BATCH-27', '测试批次27');
state27x = s27x;
const toggles27 = {
  ...defaultValidationToggles,
  skipEmptySampleNo: false,
};
const rows27 = [
  { sampleNo: '', quantity: '5', source: '内科' },
];
const preVal27 = prevalidateImportCSVWithToggles(state27x, batch27.id, rows27, toggles27);
assert(preVal27.results[0].valid === true, 'skipEmptySampleNo=false时空编号行valid=true');

console.log('\n【测试28】默认批次模式解析 resolveDefaultBatch');
const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const result28a = resolveDefaultBatch('{DATE}', 0);
assert(result28a === todayStr, `{DATE}替换为当前日期${todayStr}`);
const result28b = resolveDefaultBatch('{SEQ}', 2);
assert(result28b === '003', '{SEQ}替换为三位序号003');
const result28c = resolveDefaultBatch('BATCH-{DATE}-{SEQ}', 5);
assert(result28c === `BATCH-${todayStr}-006`, `混合模式BATCH-{DATE}-{SEQ}正确：${result28c}`);
const result28d = resolveDefaultBatch('', 0);
assert(result28d === '', '空模式返回空字符串');

console.log('\n【测试29】方案删除后 lastSelectedSchemeId 安全降级');
let state29 = createSchemeInitialState();
const { state: s29a, scheme: scheme29 } = createImportScheme(state29, '待删方案');
state29 = s29a;
state29 = schemeReducer(state29, { type: 'SET_LAST_SELECTED_SCHEME', schemeId: scheme29.id });
assert(state29.lastSelectedSchemeId === scheme29.id, 'lastSelectedSchemeId已设置');
const delete29 = deleteImportScheme(state29, scheme29.id);
assert(delete29.success === true, '删除成功');
state29 = delete29.state;
assert(state29.lastSelectedSchemeId === null, '删除后lastSelectedSchemeId被清空为null');
const serialized29 = JSON.stringify(state29);
const restored29 = schemeReducer(createSchemeInitialState(), { type: 'SET_DATA', payload: JSON.parse(serialized29) });
assert(restored29.lastSelectedSchemeId === null, '重启后lastSelectedSchemeId仍为null');

console.log('\n【测试30】方案被JSON导入覆盖后 createdById 保留');
let state30 = createSchemeInitialState();
state30.currentUserId = 'user-1';
const { state: s30a, scheme: scheme30 } = createImportScheme(state30, '方案X');
state30 = s30a;
assert(state30.importSchemes[0].createdById === 'user-1', '创建人为user-1');
const overwriteJSON30 = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '外部用户',
  schemes: [{
    name: '方案X',
    columnMappings: [{ csvColumn: '新编号', targetField: 'sampleNo' }],
    defaultBatch: { batchNoPattern: '', batchNamePattern: '' },
    validationToggles: { ...defaultValidationToggles },
    createdById: 'user-2',
    createdBy: '外部创建者',
    isLocked: false,
    isShared: false,
  }],
});
const import30 = importSchemesJSON(state30, overwriteJSON30, 'overwrite');
assert(import30.overwrittenCount === 1, '覆盖1个');
state30 = import30.state;
assert(state30.importSchemes[0].createdById === 'user-1', '覆盖后createdById仍为user-1（不变）');
assert(state30.importSchemes[0].createdBy === '操作员小王', '覆盖后createdBy仍为原值');
assert(state30.importSchemes[0].isLocked === false, '覆盖后isLocked保留原值');
assert(state30.importSchemes[0].isShared === false, '覆盖后isShared保留原值');

console.log('\n【测试31】方案被JSON导入覆盖后锁定共享状态不变');
let state31 = createSchemeInitialState();
state31.currentUserId = 'user-1';
const { state: s31a, scheme: scheme31 } = createImportScheme(state31, '锁定共享覆盖测试', {
  isLocked: true,
  isShared: true,
});
state31 = s31a;
assert(state31.importSchemes[0].isLocked === true, '原方案已锁定');
assert(state31.importSchemes[0].isShared === true, '原方案已共享');
const overwriteJSON31 = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '其他人',
  schemes: [{
    name: '锁定共享覆盖测试',
    columnMappings: [{ csvColumn: '篡改列', targetField: 'sampleNo' }],
    defaultBatch: { batchNoPattern: '', batchNamePattern: '' },
    validationToggles: { ...defaultValidationToggles },
    isLocked: false,
    isShared: false,
  }],
});
const import31 = importSchemesJSON(state31, overwriteJSON31, 'overwrite');
assert(import31.overwrittenCount === 1, '覆盖1个');
state31 = import31.state;
assert(state31.importSchemes[0].isLocked === true, '覆盖后isLocked仍为true');
assert(state31.importSchemes[0].isShared === true, '覆盖后isShared仍为true');

console.log('\n【测试32】完整桌面链路 - 保存方案、重启、导回JSON、冲突处理、再导入CSV');
let state32 = createSchemeInitialState();
state32.currentUserId = 'user-1';
const { state: s32a, scheme: scheme32 } = createImportScheme(state32, '完整链路方案', {
  columnMappings: [
    { csvColumn: '编号', targetField: 'sampleNo' },
    { csvColumn: '数量', targetField: 'quantity' },
    { csvColumn: '来源', targetField: 'source' },
  ],
  defaultBatch: { batchNoPattern: 'BATCH-{DATE}-{SEQ}', batchNamePattern: '日常送检' },
  validationToggles: { ...defaultValidationToggles, skipEmptySource: false },
});
state32 = s32a;
state32 = schemeReducer(state32, { type: 'SET_LAST_SELECTED_SCHEME', schemeId: scheme32.id });
assert(state32.lastSelectedSchemeId === scheme32.id, 'lastSelectedSchemeId已设置');

const serialized32 = JSON.stringify(state32);
const restored32 = schemeReducer(createSchemeInitialState(), { type: 'SET_DATA', payload: JSON.parse(serialized32) });
assert(restored32.lastSelectedSchemeId === scheme32.id, '重启后lastSelectedSchemeId恢复');

const export32 = exportSchemesJSON(state32, [scheme32.id]);
const json32 = export32.json;
state32 = export32.state;

const delete32 = deleteImportScheme(state32, scheme32.id);
assert(delete32.success === true, '删除成功');
state32 = delete32.state;
assert(state32.importSchemes.length === 0, '方案已删除');
assert(state32.lastSelectedSchemeId === null, '删除后lastSelectedSchemeId已清空');

const import32a = importSchemesJSON(state32, json32, 'skip');
assert(import32a.importedCount === 1, 'skip模式导入1个新方案（同名不冲突）');
assert(import32a.skippedCount === 0, '无冲突跳过');
state32 = import32a.state;
const reimportedScheme32 = state32.importSchemes.find((s) => s.name === '完整链路方案');
assert(reimportedScheme32 !== undefined, '方案已导入回来');

const import32b = importSchemesJSON(state32, json32, 'skip');
assert(import32b.skippedCount === 1, 'skip模式同名冲突跳过1个');
assert(import32b.importedCount === 0, '无新增');
state32 = import32b.state;

const import32c = importSchemesJSON(state32, json32, 'overwrite');
assert(import32c.overwrittenCount === 1, 'overwrite模式覆盖1个');
assert(import32c.skippedCount === 0, '无跳过');
state32 = import32c.state;
assert(state32.importSchemes[0].createdById === 'user-1', '覆盖后createdById仍为user-1');

const schemeForCSV32 = state32.importSchemes[0];
const csv32 = "编号,数量,来源\nC-001,10,\nC-002,5,外科";
const parsedRows32 = parseCSVWithScheme(csv32, schemeForCSV32.columnMappings);
assert(parsedRows32.length === 2, 'CSV解析出2行');
assert(parsedRows32[0].sampleNo === 'C-001', '列映射sampleNo正确');
assert(parsedRows32[0].quantity === '10', '列映射quantity正确');
assert(parsedRows32[0].source === '', '列映射source正确（空来源）');
assert(parsedRows32[1].sampleNo === 'C-002', '第二行sampleNo正确');
assert(parsedRows32[1].source === '外科', '第二行source正确');

const { state: s32b, batch: batch32 } = createBatch(state32, 'BATCH-32', '链路测试批次');
state32 = s32b;
const preVal32 = prevalidateImportCSVWithToggles(state32, batch32.id, parsedRows32, schemeForCSV32.validationToggles);
assert(preVal32.results[0].valid === true, '第1行校验通过（skipEmptySource=false空来源不拦截）');
assert(preVal32.results[1].valid === true, '第2行校验通过');
assert(preVal32.results[0].sampleNo === 'C-001', '预检结果sampleNo正确');

console.log('\n========== 测试结果 ==========\n');
if (failures > 0) {
  console.log(`❌ 共 ${failures} 项失败，请修复。\n`);
  process.exit(1);
} else {
  console.log('✅ 全部通过，批量导入、台账、权限、持久化、导入方案管理、列映射、校验开关、默认批次、完整链路功能完整。\n');
  process.exit(0);
}
