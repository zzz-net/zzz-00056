/**
 * 缺陷复现测试脚本
 *
 * 复现问题1：交接清单导出缺少交接人
 * 复现问题2：撤销退回时整条删除退回历史（含原因和备注）
 *
 * 运行方式：node tests/reproduce-bugs.test.js
 */

const { v4: uuidv4 } = require('uuid');

// ============ 模拟核心状态逻辑 ============

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

// ============ 模拟当前（有bug的）reducer ============
function buggyReducer(state, action) {
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
      // ↓↓↓ 缺陷2的根因：整条删除最后一条历史 ↓↓↓
      return {
        ...state,
        samples: state.samples.map((s) => {
          if (s.id !== action.sampleId || s.history.length < 2) return s;
          const newHistory = s.history.slice(0, -1); // 直接删除，退回原因丢失
          const prevStatus = newHistory[newHistory.length - 1].toStatus;
          return { ...s, status: prevStatus, history: newHistory };
        }),
      };
    default:
      return state;
  }
}

// ============ 模拟业务函数 ============

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
  const newState = buggyReducer(state, { type: 'ADD_SAMPLE', payload: sample });
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
  return buggyReducer(state, { type: 'UPDATE_SAMPLE', payload: updatedSample });
}

function undoLastStatus(state, sampleId) {
  return buggyReducer(state, { type: 'UNDO_LAST_STATUS', sampleId });
}

// ============ 缺陷1：交接人缺失的CSV导出 ============
function buggyExportCSV(state, batchId) {
  const samples = batchId
    ? state.samples.filter((s) => s.batchId === batchId && s.status === 'reviewed')
    : state.samples.filter((s) => s.status === 'reviewed');
  // ↓↓↓ 缺陷1的根因：headers和rows完全没有交接人字段 ↓↓↓
  const headers = ['样本编号', '所属批次', '数量', '来源', '接收时间', '接收人', '状态'];
  const rows = samples.map((s) => {
    const batch = state.batches.find((b) => b.id === s.batchId);
    return [
      s.sampleNo,
      batch?.batchNo || '',
      s.quantity.toString(),
      s.source,
      new Date(s.receivedAt).toLocaleString('zh-CN'),
      s.receivedBy,
      '已复核通过',
    ];
  });
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// ============ 测试执行 ============

let failures = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log(`  ✅ PASS: ${msg}`);
  } else {
    console.log(`  ❌ FAIL: ${msg}`);
    failures++;
  }
};

console.log('\n========== 缺陷复现测试 ==========\n');

// ---- 创建测试基础数据 ----
let state = createInitialState();
const batchId = uuidv4();
state = buggyReducer(state, {
  type: 'ADD_BATCH',
  payload: {
    id: batchId,
    batchNo: 'BATCH-TEST-HANDOVER',
    name: '交接人测试批次',
    createdAt: new Date().toISOString(),
    createdBy: '操作员小王',
  },
});

const { newState: s2, sample } = addSample(state, {
  batchId,
  sampleNo: 'SAMPLE-HANDOVER-001',
  quantity: 3,
  source: '内科病房',
  status: 'received',
  receivedAt: new Date().toISOString(),
  receivedBy: '操作员小王',
});
state = s2;
const sampleId = sample.id;

// ---- 模拟完整正向流程：分装 → 提交复核 → 复核通过 ----
state = changeSampleStatus(state, sampleId, 'aliquoted', '分装', undefined, '分装为3管');
state = changeSampleStatus(state, sampleId, 'reviewing', '提交复核');
// 切换到复核员
state.currentUserId = 'user-2';
state = changeSampleStatus(state, sampleId, 'reviewed', '复核通过', '审核通过，数量核对无误');

// ========== 复现缺陷1：导出CSV缺少交接人 ==========
console.log('【复现缺陷1】交接清单导出缺少交接人字段');
const csv = buggyExportCSV(state, batchId);
console.log('  导出CSV内容:');
console.log('  ' + csv.split('\n').join('\n  '));
const headers = csv.split('\n')[0];
assert(headers.includes('交接人'), 'CSV表头应包含「交接人」列');
assert(headers.includes('交接时间'), 'CSV表头应包含「交接时间」列');
// 检查样本是否有交接人字段
const reviewedSample = state.samples[0];
assert('handoverBy' in reviewedSample, 'Sample对象应有handoverBy（交接人）字段');
assert('handoverAt' in reviewedSample, 'Sample对象应有handoverAt（交接时间）字段');
assert(
  reviewedSample.handoverBy === '复核员老李',
  `交接人应为复核员老李，实际: ${reviewedSample.handoverBy}`
);

// ========== 复现缺陷2：撤销退回整条删除历史 ==========
console.log('\n【复现缺陷2】撤销退回整条删除退回历史');
// 先退回一个样本（用新样本更清晰）
const { newState: s3, sample: sample2 } = addSample(state, {
  batchId,
  sampleNo: 'SAMPLE-UNDO-002',
  quantity: 2,
  source: '检验科',
  status: 'received',
  receivedAt: new Date().toISOString(),
  receivedBy: '操作员小王',
});
state = s3;
const sample2Id = sample2.id;

// 分装 → 退回
state.currentUserId = 'user-1';
state = changeSampleStatus(state, sample2Id, 'aliquoted', '分装');
const returnReason = '样本破损，第2管有裂痕';
const returnRemark = '需要联系送检科室';
state = changeSampleStatus(state, sample2Id, 'returned', '退回', returnReason, returnRemark);

let sample2BeforeUndo = state.samples.find((s) => s.id === sample2Id);
const historyCountBefore = sample2BeforeUndo.history.length;
const lastHistoryBeforeUndo = sample2BeforeUndo.history[historyCountBefore - 1];
console.log(`  撤销退回前历史条数: ${historyCountBefore}`);
console.log(`  最后一条历史（退回）- 原因: "${lastHistoryBeforeUndo.reason}", 备注: "${lastHistoryBeforeUndo.remark}"`);
assert(lastHistoryBeforeUndo.reason === returnReason, '退回前历史原因应存在');
assert(lastHistoryBeforeUndo.remark === returnRemark, '退回前历史备注应存在');

// 执行撤销退回
state = undoLastStatus(state, sample2Id);
let sample2AfterUndo = state.samples.find((s) => s.id === sample2Id);
const historyCountAfter = sample2AfterUndo.history.length;
const lastHistoryAfterUndo = sample2AfterUndo.history[historyCountAfter - 1];

console.log(`  撤销退回后历史条数: ${historyCountAfter}`);
console.log(`  最后一条历史: 原因="${lastHistoryAfterUndo.reason || '(空)'}", action="${lastHistoryAfterUndo.action}"`);

// ↓↓↓ 这里应该失败（有bug时）：历史被删除了一条，原因和备注丢失 ↓↓↓
assert(
  historyCountAfter === historyCountBefore + 1,
  `撤销后历史应多1条（+撤销记录），实际：撤销前${historyCountBefore} → 撤销后${historyCountAfter}`
);
const hasReturnHistory = sample2AfterUndo.history.some(
  (h) => h.action === '退回' && h.reason === returnReason && h.remark === returnRemark
);
assert(hasReturnHistory, '撤销后退回历史（含原因和备注）仍应存在于历史记录中');
assert(
  lastHistoryAfterUndo.action === '撤销退回',
  `最后一条历史应是「撤销退回」，实际是「${lastHistoryAfterUndo.action}」`
);
assert(
  sample2AfterUndo.status === 'aliquoted',
  `状态应回退到「已分装」，实际是「${sample2AfterUndo.status}」`
);

// ========== 结果汇总 ==========
console.log('\n========== 测试结果 ==========');
if (failures > 0) {
  console.log(`❌ 共 ${failures} 项失败，缺陷复现成功，需要修复。\n`);
  process.exit(1);
} else {
  console.log('✅ 全部通过，缺陷已修复。\n');
  process.exit(0);
}
