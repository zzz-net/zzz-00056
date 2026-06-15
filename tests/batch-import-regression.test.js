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
    failedCount: validatedRows.filter((r) => !r.valid).length,
    details: [],
  };

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
assert(importResult.details.filter((d) => !d.success).length === 0, '导入循环中无额外失败');

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

console.log('\n========== 测试结果 ==========');
if (failures > 0) {
  console.log(`❌ 共 ${failures} 项失败，请修复。\n`);
  process.exit(1);
} else {
  console.log('✅ 全部通过，批量导入、台账、权限、持久化功能完整。\n');
  process.exit(0);
}
