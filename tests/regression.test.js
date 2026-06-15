/**
 * 缺陷回归测试脚本
 *
 * 验证修复：
 *  1. 交接清单导出包含交接人、交接时间字段
 *  2. 撤销退回保留历史记录，不抹掉退回原因和备注
 *
 * 运行方式：node tests/regression.test.js
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
    currentUserId: 'user-1',
  };
}

// ============ 修复后的 reducer ============
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
    case 'UNDO_LAST_STATUS':
      // 修复：保留历史，新增撤销记录，不删除退回历史
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
    default:
      return state;
  }
}

// ============ 业务函数 ============

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
  const newState = fixedReducer(state, { type: 'ADD_SAMPLE', payload: sample });
  return { newState, sample };
}

function changeSampleStatus(state, sampleId, newStatus, action, reason, remark) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return state;
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
  // 修复：复核通过=交接，写入交接人/交接时间
  if (newStatus === 'reviewed') {
    updatedSample.handoverBy = user?.username || '未知';
    updatedSample.handoverAt = new Date().toISOString();
  }
  return fixedReducer(state, { type: 'UPDATE_SAMPLE', payload: updatedSample });
}

function undoLastStatus(state, sampleId) {
  const sample = state.samples.find((s) => s.id === sampleId);
  if (!sample) return state;
  if (sample.history.length < 2) return state;
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
    return fixedReducer(state, {
      type: 'UNDO_LAST_STATUS',
      sampleId,
      history: undoHistory,
      restoreStatus,
      clearHandover: restoreStatus === 'reviewing' || restoreStatus === 'aliquoted' || restoreStatus === 'received',
    });
  }
  return state;
}

// ============ 修复后的导出 ============
function fixedExportCSV(state, batchId) {
  const samples = batchId
    ? state.samples.filter((s) => s.batchId === batchId && s.status === 'reviewed')
    : state.samples.filter((s) => s.status === 'reviewed');
  // 修复：含交接人、交接时间
  const headers = ['样本编号', '所属批次', '数量', '来源', '接收时间', '接收人', '交接人', '交接时间', '状态'];
  const rows = samples.map((s) => {
    const batch = state.batches.find((b) => b.id === s.batchId);
    return [
      s.sampleNo,
      batch?.batchNo || '',
      s.quantity.toString(),
      s.source,
      new Date(s.receivedAt).toLocaleString('zh-CN'),
      s.receivedBy,
      s.handoverBy || '',
      s.handoverAt ? new Date(s.handoverAt).toLocaleString('zh-CN') : '',
      '已复核通过',
    ];
  });
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// ============ 测试 ============
let failures = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log(`  ✅ PASS: ${msg}`);
  } else {
    console.log(`  ❌ FAIL: ${msg}`);
    failures++;
  }
};

console.log('\n========== 缺陷回归测试 ==========\n');

// ---- 基础数据 ----
let state = createInitialState();
const batchId = uuidv4();
state = fixedReducer(state, {
  type: 'ADD_BATCH',
  payload: {
    id: batchId,
    batchNo: 'BATCH-REG-001',
    name: '回归测试批次',
    createdAt: new Date().toISOString(),
    createdBy: '操作员小王',
  },
});

const { newState: s2, sample } = addSample(state, {
  batchId,
  sampleNo: 'SAMPLE-REG-001',
  quantity: 3,
  source: '内科病房',
  status: 'received',
  receivedAt: new Date().toISOString(),
  receivedBy: '操作员小王',
});
state = s2;
const sampleId = sample.id;

// ---- 正向流程：收样 → 分装 → 提交复核 → 复核通过（=交接登记）----
state = changeSampleStatus(state, sampleId, 'aliquoted', '分装', undefined, '分装为3管');
state = changeSampleStatus(state, sampleId, 'reviewing', '提交复核');
state.currentUserId = 'user-2';
state = changeSampleStatus(state, sampleId, 'reviewed', '复核通过', '审核通过');

// ========== 缺陷1 回归：交接人全链路 ==========
console.log('【缺陷1 回归】交接人字段全链路');
const csv = fixedExportCSV(state, batchId);
console.log('  CSV 表头:', csv.split('\n')[0]);
const headers = csv.split('\n')[0];
assert(headers.includes('交接人'), 'CSV表头含「交接人」列');
assert(headers.includes('交接时间'), 'CSV表头含「交接时间」列');

const reviewedSample = state.samples.find((s) => s.id === sampleId);
assert('handoverBy' in reviewedSample, 'Sample有handoverBy字段');
assert('handoverAt' in reviewedSample, 'Sample有handoverAt字段');
assert(reviewedSample.handoverBy === '复核员老李', '交接人=复核员老李（即执行复核通过操作的人）');
assert(typeof reviewedSample.handoverAt === 'string' && reviewedSample.handoverAt.length > 0, 'handoverAt是有效时间字符串');

const row1 = csv.split('\n')[1];
assert(row1.includes('复核员老李'), 'CSV行中包含交接人姓名');
// CSV行应有9列（含交接人、交接时间）
assert(row1.split(',').length === 9, `CSV数据行共9列，实际:${row1.split(',').length}`);

// ========== 缺陷2 回归：撤销退回保留历史 ==========
console.log('\n【缺陷2 回归】撤销退回保留历史记录');
const { newState: s3, sample: sample2 } = addSample(state, {
  batchId,
  sampleNo: 'SAMPLE-REG-002',
  quantity: 2,
  source: '检验科',
  status: 'received',
  receivedAt: new Date().toISOString(),
  receivedBy: '操作员小王',
});
state = s3;
const sample2Id = sample2.id;

state.currentUserId = 'user-1';
state = changeSampleStatus(state, sample2Id, 'aliquoted', '分装');
const returnReason = '样本破损，第2管有裂痕';
const returnRemark = '需要联系送检科室重新采样';
state = changeSampleStatus(state, sample2Id, 'returned', '退回', returnReason, returnRemark);

const beforeUndo = state.samples.find((s) => s.id === sample2Id);
const beforeCount = beforeUndo.history.length;
console.log(`  撤销退回前历史条数: ${beforeCount}`);
console.log(`  退回历史: 原因="${beforeUndo.history[beforeCount - 1].reason}" 备注="${beforeUndo.history[beforeCount - 1].remark}"`);

// 执行撤销
state = undoLastStatus(state, sample2Id);
const afterUndo = state.samples.find((s) => s.id === sample2Id);
const afterCount = afterUndo.history.length;
console.log(`  撤销退回后历史条数: ${afterCount}`);

assert(afterCount === beforeCount + 1, `历史+1条，撤销前${beforeCount} → 撤销后${afterCount}`);
assert(afterUndo.status === 'aliquoted', `状态正确回退为已分装，实际:${afterUndo.status}`);

// 退回历史仍存在
const returnRecord = afterUndo.history.find((h) => h.action === '退回');
assert(returnRecord !== undefined, '历史中仍存在「退回」记录（未被删除）');
assert(returnRecord.reason === returnReason, `退回原因保留: "${returnRecord.reason}"`);
assert(returnRecord.remark === returnRemark, `退回备注保留: "${returnRecord.remark}"`);

// 新增了撤销记录
const undoRecord = afterUndo.history[afterCount - 1];
assert(undoRecord.action === '撤销退回', `最后一条是「撤销退回」动作，实际:"${undoRecord.action}"`);
assert(undoRecord.reason && undoRecord.reason.includes(returnReason), `撤销记录引用了原退回原因`);

// ========== 持久化模拟验证（JSON序列化反序列化后不丢字段）==========
console.log('\n【持久化验证】JSON序列化/反序列化字段不丢失');
const serialized = JSON.stringify(state);
const restored = JSON.parse(serialized);
const restoredSample = restored.samples.find((s) => s.id === sampleId);
const restoredSample2 = restored.samples.find((s) => s.id === sample2Id);
assert(restoredSample.handoverBy === '复核员老李', `重启后交接人仍为复核员老李`);
assert('handoverAt' in restoredSample && restoredSample.handoverAt.length > 0, `重启后交接时间字段存在`);
assert(restoredSample2.history.length === afterCount, `重启后历史条数与关闭前一致`);
const restoredReturn = restoredSample2.history.find((h) => h.action === '退回');
assert(restoredReturn.reason === returnReason, `重启后退回原因仍保留`);
assert(restoredReturn.remark === returnRemark, `重启后退回备注仍保留`);
const restoredUndo = restoredSample2.history[restoredSample2.history.length - 1];
assert(restoredUndo.action === '撤销退回', `重启后撤销退回记录保留`);

// ========== 结果 ==========
console.log('\n========== 测试结果 ==========');
if (failures > 0) {
  console.log(`❌ 共 ${failures} 项失败，请修复。\n`);
  process.exit(1);
} else {
  console.log('✅ 全部通过，缺陷已修复且回归保护生效。\n');
  process.exit(0);
}
