/**
 * 导入任务中心 回归测试脚本
 *
 * 验证功能：
 *  1. 导入任务 CRUD（创建、重命名、取消、删除）
 *  2. 任务草稿持久化与跨重启恢复
 *  3. 统一校验管道（预检与正式导入一致性）
 *  4. 撤销最近一次导入（基于快照精确回滚）
 *  5. 任务审计日志
 *  6. 权限拦截（非创建人/非复核员不能修改已完成/已撤销任务）
 *  7. 方案 JSON 导入导出与同名冲突处理
 *  8. 批次快速创建不丢预检现场
 *
 * 运行方式：node tests/import-task-center.test.js
 */

const { v4: uuidv4 } = require('uuid');
const assert = require('assert');

const defaultValidationToggles = {
  skipEmptySampleNo: true,
  skipDuplicateInFile: true,
  skipDuplicateInBatch: true,
  skipInvalidQuantity: true,
  skipEmptySource: true,
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
    importSchemes: [],
    schemeAuditLog: [],
    lastSelectedSchemeId: null,
    lastSchemeChange: null,
    operationLog: [],
    importTasks: [],
    taskAuditLog: [],
    lastActiveTaskId: null,
    rollbackSnapshots: [],
    lastImportId: null,
  };
}

function appReducer(state, action) {
  switch (action.type) {
    case 'SET_DATA':
      return action.payload;
    case 'SET_CURRENT_USER':
      return { ...state, currentUserId: action.payload };
    case 'ADD_BATCH':
      return { ...state, batches: [...state.batches, action.payload] };
    case 'ADD_SAMPLE':
      return { ...state, samples: [...state.samples, action.payload] };
    case 'UPDATE_SAMPLE':
      return {
        ...state,
        samples: state.samples.map((s) => (s.id === action.payload.id ? action.payload : s)),
      };
    case 'ADD_BATCH_LEDGER_ENTRY':
      return { ...state, batchLedger: [...state.batchLedger, action.payload] };
    case 'ADD_IMPORT_RESULT':
      return { ...state, importResults: [...state.importResults, action.payload] };
    case 'UPDATE_IMPORT_RESULT':
      return {
        ...state,
        importResults: state.importResults.map((r) =>
          r.id === action.payload.id ? action.payload : r
        ),
      };
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
        lastSelectedSchemeId: state.lastSelectedSchemeId === action.schemeId ? null : state.lastSelectedSchemeId,
      };
    case 'ADD_SCHEME_AUDIT_LOG':
      return { ...state, schemeAuditLog: [...state.schemeAuditLog, action.payload] };
    case 'ADD_OPERATION_LOG':
      return { ...state, operationLog: [...state.operationLog, action.payload] };
    case 'ADD_IMPORT_TASK':
      return { ...state, importTasks: [...state.importTasks, action.payload] };
    case 'UPDATE_IMPORT_TASK':
      return {
        ...state,
        importTasks: state.importTasks.map((t) =>
          t.id === action.payload.id ? action.payload : t
        ),
      };
    case 'DELETE_IMPORT_TASK':
      return {
        ...state,
        importTasks: state.importTasks.filter((t) => t.id !== action.taskId),
        lastActiveTaskId: state.lastActiveTaskId === action.taskId ? null : state.lastActiveTaskId,
      };
    case 'ADD_TASK_AUDIT_LOG':
      return { ...state, taskAuditLog: [...state.taskAuditLog, action.payload] };
    case 'SET_LAST_ACTIVE_TASK':
      return { ...state, lastActiveTaskId: action.taskId };
    case 'ADD_ROLLBACK_SNAPSHOT':
      return { ...state, rollbackSnapshots: [...state.rollbackSnapshots, action.payload] };
    case 'REMOVE_SAMPLES_BATCH':
      return {
        ...state,
        samples: state.samples.filter((s) => !action.sampleIds.includes(s.id)),
        batchLedger: state.batchLedger.filter((l) => !action.ledgerIds.includes(l.id)),
      };
    case 'SET_LAST_IMPORT_ID':
      return { ...state, lastImportId: action.importId };
    default:
      return state;
  }
}

function getCurrentUser(state) {
  return state.users.find((u) => u.id === state.currentUserId);
}

function addOperationLog(state, category, action, detail, targetId, targetName) {
  const user = getCurrentUser(state);
  const entry = {
    id: uuidv4(),
    category,
    action,
    operatorId: state.currentUserId || '',
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail,
    targetId,
    targetName,
  };
  return appReducer(state, { type: 'ADD_OPERATION_LOG', payload: entry });
}

function addTaskAuditLog(state, taskId, taskName, action, detail) {
  const user = getCurrentUser(state);
  const entry = {
    id: uuidv4(),
    taskId,
    taskName,
    action,
    operatorId: state.currentUserId || '',
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail,
  };
  return appReducer(state, { type: 'ADD_TASK_AUDIT_LOG', payload: entry });
}

function canModifyTask(state, task) {
  if (task.status === 'completed' || task.status === 'reverted') {
    const user = getCurrentUser(state);
    return user?.role === 'reviewer' || task.createdById === state.currentUserId;
  }
  if (task.createdById !== state.currentUserId) {
    const user = getCurrentUser(state);
    return user?.role === 'reviewer';
  }
  return true;
}

function canRevertLastImport(state) {
  if (!state.lastImportId) return false;
  const snapshot = state.rollbackSnapshots.find((s) => s.importResultId === state.lastImportId);
  if (!snapshot) return false;
  const result = state.importResults.find((r) => r.id === state.lastImportId);
  if (!result || result._reverted) return false;
  const user = getCurrentUser(state);
  if (user?.role !== 'reviewer' && snapshot.createdById !== state.currentUserId) {
    return false;
  }
  return true;
}

function createBatch(state, batchNo, name) {
  const user = getCurrentUser(state);
  const batch = {
    id: uuidv4(),
    batchNo,
    name,
    createdAt: new Date().toISOString(),
    createdBy: user?.username || '未知',
  };
  let newState = appReducer(state, { type: 'ADD_BATCH', payload: batch });
  newState = addOperationLog(newState, 'batch', '创建批次', `创建批次：${batchNo}${name ? ' - ' + name : ''}`, batch.id, batchNo);
  return { state: newState, batch };
}

function checkDuplicateSampleNo(state, sampleNo, batchId, excludeId) {
  return state.samples.some(
    (s) => s.batchId === batchId && s.sampleNo === sampleNo && s.id !== excludeId
  );
}

function addSample(state, sampleData) {
  if (checkDuplicateSampleNo(state, sampleData.sampleNo, sampleData.batchId)) {
    return { state, success: false, error: '同一批次中已存在相同的样本编号，无法保存' };
  }

  const user = getCurrentUser(state);
  const sample = {
    ...sampleData,
    id: uuidv4(),
    history: [
      {
        id: uuidv4(),
        sampleId: '',
        action: '样本接收',
        operatorId: state.currentUserId || '',
        operatorName: user?.username || '未知',
        timestamp: new Date().toISOString(),
        fromStatus: '',
        toStatus: 'received',
        reason: '初次接收',
      },
    ],
  };
  sample.history[0].sampleId = sample.id;

  let newState = appReducer(state, { type: 'ADD_SAMPLE', payload: sample });

  const ledgerEntry = {
    id: uuidv4(),
    batchId: sample.batchId,
    sampleId: sample.id,
    sampleNo: sample.sampleNo,
    action: '样本接收',
    operatorId: state.currentUserId || '',
    operatorName: user?.username || '未知',
    timestamp: sample.history[0].timestamp,
    fromStatus: '',
    toStatus: 'received',
    reason: '初次接收',
  };
  newState = appReducer(newState, { type: 'ADD_BATCH_LEDGER_ENTRY', payload: ledgerEntry });

  return { state: newState, success: true, sample, ledgerEntryId: ledgerEntry.id };
}

function parseCSV(content) {
  const lines = content.split('\n').filter((line) => line.trim() !== '');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (i === 0 && (line.includes('样本编号') || line.includes('sampleNo') || line.includes('SampleNo'))) {
      continue;
    }
    const values = line.split(',').map((v) => v.trim());
    if (values.length >= 3) {
      result.push({ sampleNo: values[0], quantity: values[1], source: values[2] });
    } else if (values.length === 2) {
      result.push({ sampleNo: values[0], quantity: values[1], source: '' });
    } else if (values.length === 1) {
      result.push({ sampleNo: values[0], quantity: '', source: '' });
    }
  }
  return result;
}

function prevalidateImportCSV(state, batchId, csvRows, validationToggles) {
  const toggles = validationToggles || { ...defaultValidationToggles };
  const seenSampleNos = new Set();
  const results = csvRows.map((row, idx) => {
    const errors = [];
    const warnings = [];
    const cleanSampleNo = row.sampleNo.trim();

    if (!toggles.skipEmptySampleNo && !cleanSampleNo) {
      errors.push('样本编号不能为空');
    }
    if (!toggles.skipInvalidQuantity && (!row.quantity || isNaN(parseInt(row.quantity)) || parseInt(row.quantity) < 1)) {
      errors.push('数量必须为大于0的数字');
    }
    if (!toggles.skipEmptySource && !row.source.trim()) {
      errors.push('样本来源不能为空');
    }

    if (cleanSampleNo) {
      if (!toggles.skipDuplicateInFile && seenSampleNos.has(cleanSampleNo)) {
        errors.push(`CSV文件内存在重复的样本编号: ${cleanSampleNo}`);
      }
      seenSampleNos.add(cleanSampleNo);

      if (!toggles.skipDuplicateInBatch && checkDuplicateSampleNo(state, cleanSampleNo, batchId)) {
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

function buildImportValidationPipeline(state, batchId, csvContent, schemeId) {
  const scheme = schemeId ? state.importSchemes.find((s) => s.id === schemeId) : null;
  const columnMappings = scheme ? scheme.columnMappings : [
    { csvColumn: '样本编号', targetField: 'sampleNo' },
    { csvColumn: '数量', targetField: 'quantity' },
    { csvColumn: '来源', targetField: 'source' },
  ];
  const validationToggles = scheme ? scheme.validationToggles : { ...defaultValidationToggles };
  const parsedRows = parseCSV(csvContent);
  const prevalidateSummary = prevalidateImportCSV(state, batchId, parsedRows, validationToggles);
  return { parsedRows, validationToggles, columnMappings, prevalidateSummary };
}

function batchImportSamples(state, batchId, validatedRows, opts = {}) {
  const skipDupCheck = opts.validationToggles?.skipDuplicateInFile === true;
  const validRows = validatedRows.filter((r) => r.valid);
  const invalidRows = validatedRows.filter((r) => !r.valid);
  const importId = uuidv4();
  const importedSampleIds = [];
  const importedLedgerIds = [];
  const importedHistories = [];

  const user = getCurrentUser(state);
  const importResult = {
    id: importId,
    batchId,
    timestamp: new Date().toISOString(),
    operatorId: state.currentUserId || '',
    operatorName: user?.username || '未知',
    totalCount: validatedRows.length,
    successCount: 0,
    failedCount: 0,
    details: [],
    schemeId: opts.schemeId,
    schemeName: opts.schemeName,
    validationToggles: opts.validationToggles,
    columnMappings: opts.columnMappings,
  };

  let newState = state;

  for (const row of invalidRows) {
    importResult.failedCount++;
    importResult.details.push({
      rowIndex: row.rowIndex,
      sampleNo: row.sampleNo,
      success: false,
      error: row.errors[0] || '预检失败',
    });
  }

  const importedInThisBatch = new Map();

  for (const row of validRows) {
    try {
      if (skipDupCheck && importedInThisBatch.has(row.sampleNo)) {
        const existingSampleId = importedInThisBatch.get(row.sampleNo);
        const existingSample = newState.samples.find((s) => s.id === existingSampleId);
        if (existingSample) {
          importedSampleIds.push(existingSample.id);
          importResult.successCount++;
          importResult.details.push({ rowIndex: row.rowIndex, sampleNo: row.sampleNo, success: true });
          continue;
        }
      }

      const addResult = addSample(newState, {
        batchId,
        sampleNo: row.sampleNo,
        quantity: parseInt(row.quantity || '1') || 1,
        source: row.source?.trim() || '',
        status: 'received',
        receivedAt: new Date().toISOString(),
        receivedBy: user?.username || '未知',
      });

      newState = addResult.state;

      if (addResult.success && addResult.sample) {
        importedSampleIds.push(addResult.sample.id);
        importedInThisBatch.set(row.sampleNo, addResult.sample.id);
        if (addResult.ledgerEntryId) {
          importedLedgerIds.push(addResult.ledgerEntryId);
        }
        if (addResult.sample.history && addResult.sample.history.length > 0) {
          importedHistories.push(addResult.sample.history[0]);
        }
        importResult.successCount++;
        importResult.details.push({ rowIndex: row.rowIndex, sampleNo: row.sampleNo, success: true });
      } else {
        importResult.failedCount++;
        importResult.details.push({ rowIndex: row.rowIndex, sampleNo: row.sampleNo, success: false, error: addResult.error || '导入失败' });
      }
    } catch (e) {
      importResult.failedCount++;
      importResult.details.push({ rowIndex: row.rowIndex, sampleNo: row.sampleNo, success: false, error: e.message || '未知错误' });
    }
  }

  newState = appReducer(newState, { type: 'ADD_IMPORT_RESULT', payload: importResult });
  newState = appReducer(newState, { type: 'SET_LAST_IMPORT_ID', importId });

  if (importedSampleIds.length > 0) {
    const snapshot = {
      importResultId: importId,
      taskId: opts.taskId || null,
      removedSampleIds: importedSampleIds,
      removedBatchLedgerIds: importedLedgerIds,
      removedSampleHistories: importedHistories,
      createdAt: new Date().toISOString(),
      createdBy: user?.username || '未知',
      createdById: state.currentUserId || '',
    };
    newState = appReducer(newState, { type: 'ADD_ROLLBACK_SNAPSHOT', payload: snapshot });
  }

  newState = addOperationLog(
    newState,
    'import',
    '批量导入',
    `批次${batchId}：成功${importResult.successCount}条，失败${importResult.failedCount}条${opts.schemeName ? '，方案：' + opts.schemeName : ''}`,
    importId,
    batchId
  );

  return { state: newState, success: true, importResult, importedSampleIds };
}

function createImportTask(state, taskName, draftState) {
  const user = getCurrentUser(state);
  const scheme = draftState.selectedSchemeId
    ? state.importSchemes.find((s) => s.id === draftState.selectedSchemeId)
    : null;
  const batch = draftState.selectedBatchId
    ? state.batches.find((b) => b.id === draftState.selectedBatchId)
    : null;
  const task = {
    id: uuidv4(),
    taskName: taskName || `导入任务_${new Date().toLocaleString('zh-CN')}`,
    status: 'draft',
    batchId: draftState.selectedBatchId || null,
    batchNo: batch?.batchNo,
    schemeId: draftState.selectedSchemeId || null,
    schemeName: scheme?.name,
    draftState: {
      csvContent: draftState.csvContent || null,
      fileName: draftState.fileName || null,
      selectedBatchId: draftState.selectedBatchId || null,
      selectedSchemeId: draftState.selectedSchemeId || null,
      columnMappings: draftState.columnMappings || (scheme ? scheme.columnMappings : null),
      validationToggles: draftState.validationToggles || (scheme ? scheme.validationToggles : null),
      prevalidateSummary: draftState.prevalidateSummary || null,
      parsedRows: draftState.parsedRows || null,
    },
    importResultId: null,
    createdBy: user?.username || '未知',
    createdById: state.currentUserId || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let newState = appReducer(state, { type: 'ADD_IMPORT_TASK', payload: task });
  newState = appReducer(newState, { type: 'SET_LAST_ACTIVE_TASK', taskId: task.id });
  newState = addTaskAuditLog(newState, task.id, task.taskName, 'create', '创建导入任务');
  newState = addOperationLog(newState, 'task', '创建任务', `创建导入任务：${task.taskName}`, task.id, task.taskName);
  return { state: newState, task };
}

function updateImportTaskDraft(state, taskId, draftUpdates, statusUpdate) {
  const task = state.importTasks.find((t) => t.id === taskId);
  if (!task) return { state, success: false, error: '任务不存在' };
  if (!canModifyTask(state, task)) return { state, success: false, error: '无权修改此任务' };

  const scheme = draftUpdates.selectedSchemeId
    ? state.importSchemes.find((s) => s.id === draftUpdates.selectedSchemeId)
    : (task.schemeId ? state.importSchemes.find((s) => s.id === task.schemeId) : null);
  const batch = draftUpdates.selectedBatchId
    ? state.batches.find((b) => b.id === draftUpdates.selectedBatchId)
    : (task.batchId ? state.batches.find((b) => b.id === task.batchId) : null);

  const newStatus = statusUpdate || task.status;

  const updated = {
    ...task,
    status: newStatus,
    batchId: draftUpdates.selectedBatchId !== undefined ? draftUpdates.selectedBatchId || null : task.batchId,
    batchNo: batch?.batchNo || task.batchNo,
    schemeId: draftUpdates.selectedSchemeId !== undefined ? draftUpdates.selectedSchemeId || null : task.schemeId,
    schemeName: scheme?.name || task.schemeName,
    draftState: { ...task.draftState, ...draftUpdates },
    updatedAt: new Date().toISOString(),
  };
  let newState = appReducer(state, { type: 'UPDATE_IMPORT_TASK', payload: updated });
  if (statusUpdate === 'prevalidated') {
    newState = addTaskAuditLog(newState, taskId, updated.taskName, 'prevalidate', '完成数据预检');
  } else {
    newState = addTaskAuditLog(newState, taskId, updated.taskName, 'update_draft', '更新任务草稿');
  }
  return { state: newState, success: true, task: updated };
}

function completeImportTask(state, taskId, importResultId, importResultSnapshot) {
  const task = state.importTasks.find((t) => t.id === taskId);
  if (!task) return { state, success: false, error: '任务不存在' };
  const updated = {
    ...task,
    status: 'completed',
    importResultId,
    importResultSnapshot,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let newState = appReducer(state, { type: 'UPDATE_IMPORT_TASK', payload: updated });
  newState = addTaskAuditLog(newState, taskId, updated.taskName, 'execute', `执行完成，成功${importResultSnapshot.successCount}条，失败${importResultSnapshot.failedCount}条`);
  newState = addOperationLog(newState, 'task', '执行任务', `任务「${task.taskName}」执行完成`, taskId, task.taskName);
  return { state: newState, success: true };
}

function revertLastImport(state, reason) {
  if (!canRevertLastImport(state)) {
    return { state, success: false, error: '无可撤销的导入记录，或无权限撤销' };
  }
  const importResultId = state.lastImportId;
  const snapshot = state.rollbackSnapshots.find((s) => s.importResultId === importResultId);
  if (!snapshot) return { state, success: false, error: '撤销快照不存在' };

  const result = state.importResults.find((r) => r.id === importResultId);
  if (!result) return { state, success: false, error: '导入记录不存在' };

  let newState = appReducer(state, {
    type: 'REMOVE_SAMPLES_BATCH',
    sampleIds: snapshot.removedSampleIds,
    ledgerIds: snapshot.removedBatchLedgerIds,
  });

  const user = getCurrentUser(state);
  const updatedResult = { ...result, _reverted: true, _revertedAt: new Date().toISOString(), _revertedBy: user?.username, _revertedReason: reason || '未说明' };
  newState = appReducer(newState, { type: 'UPDATE_IMPORT_RESULT', payload: updatedResult });

  if (snapshot.taskId) {
    const task = newState.importTasks.find((t) => t.id === snapshot.taskId);
    if (task) {
      const updatedTask = {
        ...task,
        status: 'reverted',
        revertedAt: new Date().toISOString(),
        revertedBy: user?.username,
        revertedReason: reason || '未说明',
        updatedAt: new Date().toISOString(),
      };
      newState = appReducer(newState, { type: 'UPDATE_IMPORT_TASK', payload: updatedTask });
      newState = addTaskAuditLog(newState, task.id, task.taskName, 'revert', `撤销导入${reason ? '：' + reason : ''}`);
    }
  }

  newState = appReducer(newState, { type: 'SET_LAST_IMPORT_ID', importId: null });

  newState = addOperationLog(
    newState,
    'import',
    '撤销导入',
    `撤销导入记录，回滚${snapshot.removedSampleIds.length}条样本${reason ? '，原因：' + reason : ''}`,
    importResultId
  );

  return { state: newState, success: true, revertedCount: snapshot.removedSampleIds.length };
}

function createImportScheme(state, name, opts = {}) {
  const user = getCurrentUser(state);
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
    createdById: state.currentUserId || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  let newState = appReducer(state, { type: 'ADD_IMPORT_SCHEME', payload: scheme });
  return { state: newState, scheme };
}

function importSchemesJSON(state, jsonString, conflictResolution) {
  let importData;
  try {
    importData = JSON.parse(jsonString);
  } catch {
    return { state, success: false, error: 'JSON格式无效', importedCount: 0, skippedCount: 0, overwrittenCount: 0 };
  }
  if (!importData.schemes || !Array.isArray(importData.schemes)) {
    return { state, success: false, error: '导入数据缺少schemes字段', importedCount: 0, skippedCount: 0, overwrittenCount: 0 };
  }

  let importedCount = 0;
  let skippedCount = 0;
  let overwrittenCount = 0;
  let newState = state;

  for (const scheme of importData.schemes) {
    const existingByName = newState.importSchemes.find((s) => s.name === scheme.name);
    if (existingByName) {
      if (conflictResolution === 'skip') {
        skippedCount++;
        continue;
      } else if (conflictResolution === 'overwrite') {
        const updated = {
          ...scheme,
          id: existingByName.id,
          createdById: existingByName.createdById,
          createdBy: existingByName.createdBy,
          isLocked: existingByName.isLocked,
          isShared: existingByName.isShared,
          updatedAt: new Date().toISOString(),
        };
        newState = appReducer(newState, { type: 'UPDATE_IMPORT_SCHEME', payload: updated });
        overwrittenCount++;
        continue;
      }
    }
    const user = getCurrentUser(newState);
    const newScheme = {
      ...scheme,
      id: uuidv4(),
      createdBy: user?.username || '未知',
      createdById: newState.currentUserId || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isShared: false,
      isLocked: false,
    };
    newState = appReducer(newState, { type: 'ADD_IMPORT_SCHEME', payload: newScheme });
    importedCount++;
  }

  newState = addOperationLog(newState, 'scheme', '导入方案', `导入完成：新增${importedCount}，覆盖${overwrittenCount}，跳过${skippedCount}`);

  return { state: newState, success: true, importedCount, skippedCount, overwrittenCount };
}

function exportSchemesJSON(state, schemeIds) {
  const schemes = state.importSchemes.filter((s) => schemeIds.includes(s.id));
  const user = getCurrentUser(state);
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: user?.username || '未知',
    schemes,
  };
  return JSON.stringify(exportData, null, 2);
}

function runTests() {
  console.log('\n===== 导入任务中心 回归测试 =====\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (e) {
      console.log(`❌ ${name}`);
      console.log(`   错误: ${e.message}`);
      failed++;
    }
  }

  // ========== 测试 1: 任务创建与草稿更新 ==========
  test('任务创建与草稿更新', () => {
    let state = createInitialState();
    const createResult = createImportTask(state, '测试任务-001', {});
    state = createResult.state;
    const task = createResult.task;

    assert.strictEqual(state.importTasks.length, 1, '任务数量应为1');
    assert.strictEqual(task.taskName, '测试任务-001', '任务名称正确');
    assert.strictEqual(task.status, 'draft', '初始状态为草稿');
    assert.strictEqual(state.lastActiveTaskId, task.id, 'lastActiveTaskId 已设置');

    const { batch } = createBatch(state, 'BATCH-TEST-001', '测试批次');
    state = batch ? state : state;
    if (batch) {
      const batchCreateResult = createBatch(state, 'BATCH-TEST-001', '测试批次');
      state = batchCreateResult.state;
    }

    const csvContent = '样本编号,数量,来源\nS-001,5,内科\nS-002,3,\nS-003,10,外科';
    const updateResult = updateImportTaskDraft(state, task.id, {
      csvContent,
      fileName: 'test.csv',
      selectedBatchId: state.batches[0]?.id,
    });
    state = updateResult.state;

    const updatedTask = state.importTasks.find((t) => t.id === task.id);
    assert.strictEqual(updatedTask.draftState.csvContent, csvContent, 'CSV内容已保存');
    assert.strictEqual(updatedTask.draftState.fileName, 'test.csv', '文件名已保存');
    assert.strictEqual(state.taskAuditLog.length, 2, '应有2条审计日志（创建+更新）');
  });

  // ========== 测试 2: 统一校验管道一致性 ==========
  test('统一校验管道 - 预检与正式导入使用同一管道', () => {
    let state = createInitialState();
    const { state: stateWithBatch, batch } = createBatch(state, 'BATCH-PIPELINE-001', '管道测试批次');
    state = stateWithBatch;

    const csvContent = '样本编号,数量,来源\nS-001,5,内科\nS-002,3,\nS-003,10,外科';

    const pipeline = buildImportValidationPipeline(state, batch.id, csvContent, null);
    assert.strictEqual(pipeline.prevalidateSummary.total, 3, '预检总数应为3');
    assert.strictEqual(pipeline.prevalidateSummary.validCount, 3, '默认校验下skipEmptySource=true，空来源不拦截，有效数3');

    const togglesNoSourceCheck = { ...defaultValidationToggles, skipEmptySource: false };
    const { state: stateWithScheme, scheme } = createImportScheme(state, '关闭空来源校验方案', {
      validationToggles: togglesNoSourceCheck,
    });
    state = stateWithScheme;

    const pipelineWithScheme = buildImportValidationPipeline(state, batch.id, csvContent, scheme.id);
    assert.strictEqual(pipelineWithScheme.prevalidateSummary.validCount, 2, '不跳过空来源校验（拦截空来源）后，空来源失败，有效数应为2');
    assert.strictEqual(pipelineWithScheme.validationToggles.skipEmptySource, false, '校验开关正确传递');

    const importResult = batchImportSamples(state, batch.id, pipelineWithScheme.prevalidateSummary.results, {
      schemeId: scheme.id,
      schemeName: scheme.name,
      validationToggles: pipelineWithScheme.validationToggles,
      columnMappings: pipelineWithScheme.columnMappings,
    });
    state = importResult.state;

    assert.strictEqual(importResult.importResult.successCount, 2, '正式导入成功数与预检一致，均为2');
    assert.strictEqual(state.samples.length, 2, '样本库中应有2条样本');
  });

  // ========== 测试 3: 撤销最近一次导入（精确回滚） ==========
  test('撤销最近一次导入 - 基于快照精确回滚', () => {
    let state = createInitialState();
    const { state: stateWithBatch, batch } = createBatch(state, 'BATCH-REVERT-001', '撤销测试批次');
    state = stateWithBatch;

    const csvContent = '样本编号,数量,来源\nS-REV-001,5,内科\nS-REV-002,3,外科\nS-REV-003,10,检验科';
    const pipeline = buildImportValidationPipeline(state, batch.id, csvContent, null);

    const importResult = batchImportSamples(state, batch.id, pipeline.prevalidateSummary.results);
    state = importResult.state;

    assert.strictEqual(state.samples.length, 3, '导入后应有3条样本');
    assert.strictEqual(state.batchLedger.length, 3, '应有3条台账记录');
    assert.strictEqual(state.rollbackSnapshots.length, 1, '应有1条撤销快照');
    assert.strictEqual(state.lastImportId, importResult.importResult.id, 'lastImportId 已设置');
    assert.strictEqual(canRevertLastImport(state), true, '可以撤销');

    const revertResult = revertLastImport(state, '测试撤销');
    state = revertResult.state;

    assert.strictEqual(revertResult.success, true, '撤销成功');
    assert.strictEqual(revertResult.revertedCount, 3, '回滚3条样本');
    assert.strictEqual(state.samples.length, 0, '样本库已清空');
    assert.strictEqual(state.batchLedger.length, 0, '台账记录已清空');
    assert.strictEqual(state.lastImportId, null, 'lastImportId 已清除');
    assert.strictEqual(canRevertLastImport(state), false, '不能重复撤销');

    const revertedImportResult = state.importResults.find((r) => r.id === importResult.importResult.id);
    assert.strictEqual(revertedImportResult._reverted, true, '导入结果标记为已撤销');
    assert.strictEqual(revertedImportResult._revertedReason, '测试撤销', '撤销原因已记录');
  });

  // ========== 测试 4: 任务关联导入与撤销 ==========
  test('任务关联导入 - 撤销后任务状态同步为reverted', () => {
    let state = createInitialState();
    const { state: stateWithBatch, batch } = createBatch(state, 'BATCH-TASK-REVERT-001', '任务撤销测试');
    state = stateWithBatch;

    const taskResult = createImportTask(state, '关联任务测试', {});
    state = taskResult.state;
    const task = taskResult.task;

    const csvContent = '样本编号,数量,来源\nS-TASK-001,5,内科\nS-TASK-002,3,外科';
    const pipeline = buildImportValidationPipeline(state, batch.id, csvContent, null);

    const updateResult = updateImportTaskDraft(state, task.id, {
      csvContent,
      selectedBatchId: batch.id,
      prevalidateSummary: pipeline.prevalidateSummary,
      parsedRows: pipeline.parsedRows,
    }, 'prevalidated');
    state = updateResult.state;

    const importResult = batchImportSamples(state, batch.id, pipeline.prevalidateSummary.results, {
      taskId: task.id,
    });
    state = importResult.state;

    const completeResult = completeImportTask(state, task.id, importResult.importResult.id, importResult.importResult);
    state = completeResult.state;

    const completedTask = state.importTasks.find((t) => t.id === task.id);
    assert.strictEqual(completedTask.status, 'completed', '任务状态为已完成');
    assert.strictEqual(completedTask.importResultId, importResult.importResult.id, '关联导入结果ID');

    const revertResult = revertLastImport(state, '测试任务撤销');
    state = revertResult.state;

    const revertedTask = state.importTasks.find((t) => t.id === task.id);
    assert.strictEqual(revertedTask.status, 'reverted', '任务状态变为已撤销');
    assert.strictEqual(revertedTask.revertedReason, '测试任务撤销', '撤销原因已同步');
    assert.strictEqual(revertedTask.revertedBy, '操作员小王', '撤销人已记录');
  });

  // ========== 测试 5: 权限拦截 ==========
  test('权限拦截 - 非创建人普通操作员不能修改已完成任务', () => {
    let state = createInitialState();
    const { state: stateWithBatch, batch } = createBatch(state, 'BATCH-PERM-001', '权限测试批次');
    state = stateWithBatch;

    const taskResult = createImportTask(state, '权限测试任务', {});
    state = taskResult.state;
    const task = taskResult.task;

    const csvContent = '样本编号,数量,来源\nS-PERM-001,5,内科';
    const pipeline = buildImportValidationPipeline(state, batch.id, csvContent, null);
    const importResult = batchImportSamples(state, batch.id, pipeline.prevalidateSummary.results, { taskId: task.id });
    state = importResult.state;
    const completeResult = completeImportTask(state, task.id, importResult.importResult.id, importResult.importResult);
    state = completeResult.state;

    state = appReducer(state, { type: 'SET_CURRENT_USER', payload: 'user-2' });
    const reviewerTask = state.importTasks.find((t) => t.id === task.id);
    assert.strictEqual(canModifyTask(state, reviewerTask), true, '复核员可以修改已完成任务');

    state = { ...state, currentUserId: 'non-exist-user' };
    const otherUserTask = state.importTasks.find((t) => t.id === task.id);
    assert.strictEqual(canModifyTask(state, otherUserTask), false, '非创建人非复核员不能修改已完成任务');

    state = { ...state, currentUserId: 'user-1' };
    const ownerTask = state.importTasks.find((t) => t.id === task.id);
    assert.strictEqual(canModifyTask(state, ownerTask), true, '创建人可以修改自己的已完成任务');
  });

  // ========== 测试 6: 草稿跨重启恢复 ==========
  test('草稿跨重启恢复 - mergeWithDefaults 兜底验证', () => {
    let state = createInitialState();
    const taskResult = createImportTask(state, '重启恢复测试', {
      csvContent: '样本编号,数量,来源\nS-RESTORE-001,5,内科',
      fileName: 'restore.csv',
    });
    state = taskResult.state;
    const task = taskResult.task;

    const partialData = {
      importTasks: [{ id: task.id, taskName: task.taskName, status: 'draft' }],
      lastActiveTaskId: task.id,
    };

    function mergeWithDefaults(data) {
      const merged = {
        ...createInitialState(),
        ...data,
        importTasks: (data.importTasks || []).map((t) => ({
          ...t,
          draftState: t.draftState || {
            csvContent: null, fileName: null, selectedBatchId: null,
            selectedSchemeId: null, columnMappings: null, validationToggles: null,
            prevalidateSummary: null, parsedRows: null,
          },
        })),
        lastActiveTaskId: data.lastActiveTaskId || null,
      };
      if (merged.lastActiveTaskId) {
        const taskExists = merged.importTasks.some((t) => t.id === merged.lastActiveTaskId);
        if (!taskExists) merged.lastActiveTaskId = null;
      }
      return merged;
    }

    const restored = mergeWithDefaults(partialData);
    assert.strictEqual(restored.importTasks[0].draftState.csvContent, null, '缺失字段被兜底为null');
    assert.strictEqual(restored.importTasks[0].draftState.fileName, null, 'fileName 兜底正确');
    assert.strictEqual(restored.lastActiveTaskId, task.id, 'lastActiveTaskId 保留');

    const partialDataInvalidTask = { ...partialData, lastActiveTaskId: 'invalid-id' };
    const restoredInvalid = mergeWithDefaults(partialDataInvalidTask);
    assert.strictEqual(restoredInvalid.lastActiveTaskId, null, '无效 taskId 被清空');
  });

  // ========== 测试 7: 方案导入导出与同名冲突 ==========
  test('方案导入导出与同名冲突处理', () => {
    let state = createInitialState();
    const { state: stateWithScheme, scheme } = createImportScheme(state, '测试方案-A', {
      validationToggles: { ...defaultValidationToggles, skipEmptySource: false },
    });
    state = stateWithScheme;

    const jsonStr = exportSchemesJSON(state, [scheme.id]);
    assert.ok(jsonStr.includes('"version": 1'), '导出JSON包含version');
    assert.ok(jsonStr.includes('"测试方案-A"'), '导出JSON包含方案名');

    const importSkipResult = importSchemesJSON(state, jsonStr, 'skip');
    state = importSkipResult.state;
    assert.strictEqual(importSkipResult.skippedCount, 1, 'skip模式跳过同名');
    assert.strictEqual(state.importSchemes.length, 1, '方案数量不变');

    const importOverwriteResult = importSchemesJSON(state, jsonStr, 'overwrite');
    state = importOverwriteResult.state;
    assert.strictEqual(importOverwriteResult.overwrittenCount, 1, 'overwrite模式覆盖同名');
    assert.strictEqual(state.importSchemes[0].createdById, 'user-1', '覆盖后createdById保留原创建人');
  });

  // ========== 测试 8: 批次快速创建不丢预检现场 ==========
  test('批次快速创建 - 不丢CSV预检现场', () => {
    let state = createInitialState();
    const taskResult = createImportTask(state, '快速建批测试', {});
    state = taskResult.state;
    const task = taskResult.task;

    const csvContent = '样本编号,数量,来源\nS-QUICK-001,5,内科\nS-QUICK-002,3,外科';
    const updateResult = updateImportTaskDraft(state, task.id, {
      csvContent,
      fileName: 'quick.csv',
    });
    state = updateResult.state;

    const { state: stateWithBatch, batch } = createBatch(state, 'BATCH-QUICK-001', '快速建批');
    state = stateWithBatch;

    const pipeline = buildImportValidationPipeline(state, batch.id, csvContent, null);
    const finalUpdateResult = updateImportTaskDraft(state, task.id, {
      selectedBatchId: batch.id,
      prevalidateSummary: pipeline.prevalidateSummary,
      parsedRows: pipeline.parsedRows,
    }, 'prevalidated');
    state = finalUpdateResult.state;

    const finalTask = state.importTasks.find((t) => t.id === task.id);
    assert.strictEqual(finalTask.draftState.csvContent, csvContent, 'CSV内容未丢失');
    assert.strictEqual(finalTask.draftState.fileName, 'quick.csv', '文件名未丢失');
    assert.strictEqual(finalTask.draftState.selectedBatchId, batch.id, '批次ID已更新');
    assert.strictEqual(finalTask.draftState.prevalidateSummary.total, 2, '预检结果已生成');
    assert.strictEqual(finalTask.status, 'prevalidated', '状态变为已预检');
  });

  // ========== 测试 9: 任务审计日志 ==========
  test('任务审计日志 - 全链路操作留痕', () => {
    let state = createInitialState();
    const taskResult = createImportTask(state, '审计测试任务', {});
    state = taskResult.state;
    const task = taskResult.task;

    const updateResult = updateImportTaskDraft(state, task.id, { fileName: 'audit.csv' });
    state = updateResult.state;

    const auditLogs = state.taskAuditLog.filter((l) => l.taskId === task.id);
    assert.strictEqual(auditLogs.length, 2, '应有2条审计日志');
    assert.strictEqual(auditLogs[0].action, 'create', '第一条是创建');
    assert.strictEqual(auditLogs[1].action, 'update_draft', '第二条是更新草稿');
    assert.strictEqual(auditLogs[0].operatorId, 'user-1', '操作人正确');
    assert.strictEqual(auditLogs[0].operatorName, '操作员小王', '操作人姓名正确');
  });

  // ========== 测试 10: 撤销权限拦截 ==========
  test('撤销权限 - 非本人非复核员不能撤销', () => {
    let state = createInitialState();
    const { state: stateWithBatch, batch } = createBatch(state, 'BATCH-PERM-REV-001', '撤销权限测试');
    state = stateWithBatch;

    const csvContent = '样本编号,数量,来源\nS-PERM-REV-001,5,内科';
    const pipeline = buildImportValidationPipeline(state, batch.id, csvContent, null);
    const importResult = batchImportSamples(state, batch.id, pipeline.prevalidateSummary.results);
    state = importResult.state;

    assert.strictEqual(canRevertLastImport(state), true, '本人可以撤销');

    const originalState = { ...state };
    state.currentUserId = 'another-user';
    assert.strictEqual(canRevertLastImport(state), false, '非本人非复核员不能撤销');

    state.currentUserId = 'user-2';
    assert.strictEqual(canRevertLastImport(state), true, '复核员可以撤销任何人的导入');

    state = originalState;
  });

  console.log(`\n===== 测试完成: ${passed} 通过, ${failed} 失败 =====\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
