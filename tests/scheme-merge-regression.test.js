const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const defaultValidationToggles = {
  skipEmptySampleNo: true,
  skipDuplicateInFile: true,
  skipDuplicateInBatch: true,
  skipInvalidQuantity: true,
  skipEmptySource: true,
};

const FIELD_LABELS = {
  columnMappings: '列映射',
  'defaultBatch.batchNoPattern': '默认批次号模式',
  'defaultBatch.batchNamePattern': '默认批次名称模式',
  'validationToggles.skipEmptySampleNo': '校验：空样本编号',
  'validationToggles.skipDuplicateInFile': '校验：CSV内重复编号',
  'validationToggles.skipDuplicateInBatch': '校验：批次内已存在编号',
  'validationToggles.skipInvalidQuantity': '校验：无效数量',
  'validationToggles.skipEmptySource': '校验：空来源',
  isShared: '共享状态',
  isLocked: '锁定状态',
};

const ALL_FIELD_NAMES = [
  'columnMappings',
  'defaultBatch.batchNoPattern',
  'defaultBatch.batchNamePattern',
  'validationToggles.skipEmptySampleNo',
  'validationToggles.skipDuplicateInFile',
  'validationToggles.skipDuplicateInBatch',
  'validationToggles.skipInvalidQuantity',
  'validationToggles.skipEmptySource',
  'isShared',
  'isLocked',
];

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
    schemeMergeLogs: [],
    lastSchemeMergeId: null,
    schemeMergeSnapshots: [],
  };
}

function appReducer(state, action) {
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
        lastSelectedSchemeId: state.lastSelectedSchemeId === action.schemeId ? null : state.lastSelectedSchemeId,
      };
    case 'ADD_SCHEME_AUDIT_LOG':
      return { ...state, schemeAuditLog: [...state.schemeAuditLog, action.payload] };
    case 'SET_LAST_SELECTED_SCHEME':
      return { ...state, lastSelectedSchemeId: action.schemeId };
    case 'SET_LAST_SCHEME_CHANGE':
      return { ...state, lastSchemeChange: action.payload };
    case 'CLEAR_LAST_SCHEME_CHANGE':
      return { ...state, lastSchemeChange: null };
    case 'ADD_OPERATION_LOG':
      return { ...state, operationLog: [...state.operationLog, action.payload] };
    case 'ADD_SCHEME_MERGE_LOG':
      return { ...state, schemeMergeLogs: [...state.schemeMergeLogs, action.payload] };
    case 'SET_LAST_SCHEME_MERGE_ID':
      return { ...state, lastSchemeMergeId: action.mergeId };
    case 'ADD_SCHEME_MERGE_SNAPSHOT':
      return { ...state, schemeMergeSnapshots: [...state.schemeMergeSnapshots, action.payload] };
    case 'RESTORE_SCHEME_MERGE':
      return {
        ...state,
        importSchemes: [...action.payload.originalSchemes],
        lastSchemeMergeId: null,
      };
    case 'SET_DATA':
      return action.payload;
    default:
      return state;
  }
}

function canModifyScheme(state, scheme) {
  if (scheme.isLocked && scheme.isShared && scheme.createdById !== state.currentUserId) {
    return false;
  }
  return true;
}

function getFieldValue(scheme, fieldName) {
  switch (fieldName) {
    case 'columnMappings': return scheme.columnMappings;
    case 'defaultBatch.batchNoPattern': return scheme.defaultBatch?.batchNoPattern;
    case 'defaultBatch.batchNamePattern': return scheme.defaultBatch?.batchNamePattern;
    case 'validationToggles.skipEmptySampleNo': return scheme.validationToggles?.skipEmptySampleNo;
    case 'validationToggles.skipDuplicateInFile': return scheme.validationToggles?.skipDuplicateInFile;
    case 'validationToggles.skipDuplicateInBatch': return scheme.validationToggles?.skipDuplicateInBatch;
    case 'validationToggles.skipInvalidQuantity': return scheme.validationToggles?.skipInvalidQuantity;
    case 'validationToggles.skipEmptySource': return scheme.validationToggles?.skipEmptySource;
    case 'isShared': return scheme.isShared;
    case 'isLocked': return scheme.isLocked;
  }
}

function setFieldValue(scheme, fieldName, value) {
  switch (fieldName) {
    case 'columnMappings': return { ...scheme, columnMappings: value };
    case 'defaultBatch.batchNoPattern': return { ...scheme, defaultBatch: { ...scheme.defaultBatch, batchNoPattern: value } };
    case 'defaultBatch.batchNamePattern': return { ...scheme, defaultBatch: { ...scheme.defaultBatch, batchNamePattern: value } };
    case 'validationToggles.skipEmptySampleNo': return { ...scheme, validationToggles: { ...scheme.validationToggles, skipEmptySampleNo: value } };
    case 'validationToggles.skipDuplicateInFile': return { ...scheme, validationToggles: { ...scheme.validationToggles, skipDuplicateInFile: value } };
    case 'validationToggles.skipDuplicateInBatch': return { ...scheme, validationToggles: { ...scheme.validationToggles, skipDuplicateInBatch: value } };
    case 'validationToggles.skipInvalidQuantity': return { ...scheme, validationToggles: { ...scheme.validationToggles, skipInvalidQuantity: value } };
    case 'validationToggles.skipEmptySource': return { ...scheme, validationToggles: { ...scheme.validationToggles, skipEmptySource: value } };
    case 'isShared': return { ...scheme, isShared: value };
    case 'isLocked': return { ...scheme, isLocked: value };
  }
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

  let newState = appReducer(state, { type: 'ADD_IMPORT_SCHEME', payload: scheme });
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
  newState = appReducer(newState, { type: 'ADD_SCHEME_AUDIT_LOG', payload: auditEntry });

  return { state: newState, scheme };
}

function exportSchemesJSON(state, schemeIds) {
  const schemes = state.importSchemes.filter((s) => schemeIds.includes(s.id));
  const user = state.users.find((u) => u.id === state.currentUserId);
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: user?.username || '未知',
    schemes,
  };
  return JSON.stringify(exportData, null, 2);
}

function previewSchemeMerge(state, jsonString) {
  const emptyPreview = {
    conflictItems: [],
    newSchemes: [],
    totalIncoming: 0,
    conflictCount: 0,
    newCount: 0,
    blockedCount: 0,
  };

  let importData;
  try {
    importData = JSON.parse(jsonString);
  } catch (e) {
    return emptyPreview;
  }
  if (!importData.schemes || !Array.isArray(importData.schemes)) {
    return emptyPreview;
  }

  const conflictItems = [];
  const newSchemes = [];

  for (const incoming of importData.schemes) {
    const existing = state.importSchemes.find((s) => s.name === incoming.name);
    if (!existing) {
      newSchemes.push(incoming);
      continue;
    }

    let canMerge = true;
    let blockReason;

    if (!canModifyScheme(state, existing)) {
      canMerge = false;
      blockReason = '只读共享方案，无法合并';
    }

    if (canMerge) {
      const hasRequiredFields = incoming.columnMappings && incoming.defaultBatch && incoming.validationToggles;
      if (!hasRequiredFields) {
        canMerge = false;
        blockReason = '字段结构不兼容';
      }
    }

    const fieldDiffs = ALL_FIELD_NAMES.map((fieldName) => {
      const originalValue = getFieldValue(existing, fieldName);
      const newValue = getFieldValue(incoming, fieldName);
      const isSame = JSON.stringify(originalValue) === JSON.stringify(newValue);
      return {
        fieldName,
        fieldLabel: FIELD_LABELS[fieldName],
        originalValue,
        newValue,
        isSame,
        resolution: isSame ? 'keep_original' : 'conflict',
      };
    });

    const hasUnresolvedConflicts = canMerge && fieldDiffs.some((d) => !d.isSame && d.resolution === 'conflict');

    conflictItems.push({
      incomingScheme: incoming,
      existingScheme: existing,
      canMerge,
      blockReason,
      fieldDiffs,
      hasUnresolvedConflicts,
    });
  }

  const blockedCount = conflictItems.filter((c) => !c.canMerge).length;

  return {
    conflictItems,
    newSchemes,
    totalIncoming: importData.schemes.length,
    conflictCount: conflictItems.length,
    newCount: newSchemes.length,
    blockedCount,
  };
}

function mergeImportSchemes(state, preview, conflictResolutions) {
  for (const item of preview.conflictItems) {
    if (!item.canMerge) continue;
    const schemeResolutions = conflictResolutions[item.existingScheme.id];
    if (!schemeResolutions) {
      return { state, success: false, error: '存在未解决的冲突，无法确认导入', mergedCount: 0, newCount: 0, blockedCount: 0, mergeId: '' };
    }
    const hasUnresolved = item.fieldDiffs.some(
      (d) => !d.isSame && (!schemeResolutions[d.fieldName] || schemeResolutions[d.fieldName] === 'conflict')
    );
    if (hasUnresolved) {
      return { state, success: false, error: '存在未解决的冲突，无法确认导入', mergedCount: 0, newCount: 0, blockedCount: 0, mergeId: '' };
    }
  }

  const mergeId = uuidv4();
  const user = state.users.find((u) => u.id === state.currentUserId);
  let mergedCount = 0;
  let newCount = 0;
  let currentState = state;
  const addedSchemeIds = [];

  currentState = appReducer(currentState, {
    type: 'ADD_SCHEME_MERGE_SNAPSHOT',
    payload: {
      mergeId,
      originalSchemes: [...state.importSchemes],
      addedSchemeIds: [],
      operatorId: state.currentUserId || '',
      operatorName: user?.username || '未知',
      createdAt: new Date().toISOString(),
    },
  });

  for (const newSchemeData of preview.newSchemes) {
    const newScheme = {
      ...newSchemeData,
      id: uuidv4(),
      createdBy: user?.username || '未知',
      createdById: state.currentUserId || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isShared: false,
      isLocked: false,
    };
    currentState = appReducer(currentState, { type: 'ADD_IMPORT_SCHEME', payload: newScheme });
    addedSchemeIds.push(newScheme.id);

    currentState = appReducer(currentState, {
      type: 'ADD_SCHEME_MERGE_LOG',
      payload: {
        id: uuidv4(),
        mergeId,
        schemeId: newScheme.id,
        schemeName: newScheme.name,
        action: 'merge_new',
        operatorId: state.currentUserId || '',
        operatorName: user?.username || '未知',
        timestamp: new Date().toISOString(),
        fieldSources: [],
      },
    });
    newCount++;
  }

  for (const item of preview.conflictItems) {
    if (!item.canMerge) {
      currentState = appReducer(currentState, {
        type: 'ADD_SCHEME_MERGE_LOG',
        payload: {
          id: uuidv4(),
          mergeId,
          schemeId: item.existingScheme.id,
          schemeName: item.existingScheme.name,
          action: 'merge_blocked',
          operatorId: state.currentUserId || '',
          operatorName: user?.username || '未知',
          timestamp: new Date().toISOString(),
          fieldSources: [],
          blockReason: item.blockReason,
        },
      });
      continue;
    }

    const schemeResolutions = conflictResolutions[item.existingScheme.id];
    let mergedScheme = { ...item.existingScheme };
    const fieldSources = [];

    for (const diff of item.fieldDiffs) {
      const resolution = schemeResolutions[diff.fieldName] || 'keep_original';
      if (resolution === 'use_new') {
        mergedScheme = setFieldValue(mergedScheme, diff.fieldName, diff.newValue);
        fieldSources.push({
          fieldName: diff.fieldName,
          fieldLabel: FIELD_LABELS[diff.fieldName],
          source: 'new',
          originalValue: diff.originalValue,
          newValue: diff.newValue,
        });
      } else {
        fieldSources.push({
          fieldName: diff.fieldName,
          fieldLabel: FIELD_LABELS[diff.fieldName],
          source: 'original',
          originalValue: diff.originalValue,
          newValue: diff.newValue,
        });
      }
    }

    mergedScheme = { ...mergedScheme, updatedAt: new Date().toISOString() };
    currentState = appReducer(currentState, { type: 'UPDATE_IMPORT_SCHEME', payload: mergedScheme });

    currentState = appReducer(currentState, {
      type: 'ADD_SCHEME_MERGE_LOG',
      payload: {
        id: uuidv4(),
        mergeId,
        schemeId: item.existingScheme.id,
        schemeName: item.existingScheme.name,
        action: 'merge',
        operatorId: state.currentUserId || '',
        operatorName: user?.username || '未知',
        timestamp: new Date().toISOString(),
        fieldSources,
      },
    });
    mergedCount++;
  }

  const blockedCount = preview.conflictItems.filter((c) => !c.canMerge).length;

  const opLogEntry = {
    id: uuidv4(),
    category: 'merge',
    action: '合并方案',
    operatorId: state.currentUserId || '',
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail: `合并完成：新增${newCount}，合并${mergedCount}，阻止${blockedCount}`,
    targetId: mergeId,
    targetName: undefined,
  };
  currentState = appReducer(currentState, { type: 'ADD_OPERATION_LOG', payload: opLogEntry });

  currentState = appReducer(currentState, { type: 'SET_LAST_SCHEME_MERGE_ID', mergeId });

  const snapshotIdx = currentState.schemeMergeSnapshots.findIndex((s) => s.mergeId === mergeId);
  if (snapshotIdx !== -1) {
    const updatedSnapshots = [...currentState.schemeMergeSnapshots];
    updatedSnapshots[snapshotIdx] = { ...updatedSnapshots[snapshotIdx], addedSchemeIds };
    currentState = { ...currentState, schemeMergeSnapshots: updatedSnapshots };
  }

  return { state: currentState, success: true, mergedCount, newCount, blockedCount, mergeId };
}

function undoLastSchemeMerge(state) {
  if (!state.lastSchemeMergeId) {
    return { state, success: false, error: '无可撤销的合并记录' };
  }

  const snapshot = state.schemeMergeSnapshots.find((s) => s.mergeId === state.lastSchemeMergeId);
  if (!snapshot) {
    return { state, success: false, error: '合并快照不存在' };
  }

  let currentState = appReducer(state, {
    type: 'RESTORE_SCHEME_MERGE',
    payload: { originalSchemes: snapshot.originalSchemes, addedSchemeIds: snapshot.addedSchemeIds },
  });

  const user = state.users.find((u) => u.id === state.currentUserId);
  const logEntries = state.schemeMergeLogs.filter((l) => l.mergeId === snapshot.mergeId);
  for (const entry of logEntries) {
    currentState = appReducer(currentState, {
      type: 'ADD_SCHEME_MERGE_LOG',
      payload: {
        id: uuidv4(),
        mergeId: snapshot.mergeId,
        schemeId: entry.schemeId,
        schemeName: entry.schemeName,
        action: 'merge_undo',
        operatorId: state.currentUserId || '',
        operatorName: user?.username || '未知',
        timestamp: new Date().toISOString(),
        fieldSources: [],
        detail: `撤销合并「${snapshot.mergeId}」`,
      },
    });
  }

  const opLogEntry = {
    id: uuidv4(),
    category: 'merge',
    action: '撤销合并',
    operatorId: state.currentUserId || '',
    operatorName: user?.username || '未知',
    timestamp: new Date().toISOString(),
    detail: `撤销合并操作：${snapshot.mergeId}`,
    targetId: snapshot.mergeId,
    targetName: undefined,
  };
  currentState = appReducer(currentState, { type: 'ADD_OPERATION_LOG', payload: opLogEntry });

  return { state: currentState, success: true };
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

console.log('\n========== 合并导入功能 回归测试 ==========\n');

let state = createInitialState();

console.log('【测试1】导入新方案 - Import a JSON with 2 new schemes (no name conflicts)');
const newSchemesJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '外部用户',
  schemes: [
    {
      name: '外部方案A',
      columnMappings: [{ csvColumn: '编号', targetField: 'sampleNo' }],
      defaultBatch: { batchNoPattern: 'EXT-{DATE}', batchNamePattern: '外部批次' },
      validationToggles: { ...defaultValidationToggles, skipEmptySource: false },
      isShared: false,
      isLocked: false,
    },
    {
      name: '外部方案B',
      columnMappings: [
        { csvColumn: '样本编号', targetField: 'sampleNo' },
        { csvColumn: '数量', targetField: 'quantity' },
        { csvColumn: '来源', targetField: 'source' },
      ],
      defaultBatch: { batchNoPattern: 'BATCH-{DATE}', batchNamePattern: '日常送检' },
      validationToggles: { ...defaultValidationToggles },
      isShared: false,
      isLocked: false,
    },
  ],
});

const preview1 = previewSchemeMerge(state, newSchemesJSON);
assert(preview1.totalIncoming === 2, '预览：共2个方案');
assert(preview1.newCount === 2, '预览：2个新方案');
assert(preview1.conflictCount === 0, '预览：0个冲突');
assert(preview1.blockedCount === 0, '预览：0个被阻止');
assert(preview1.newSchemes.length === 2, '预览：newSchemes数组长度2');
assert(preview1.newSchemes[0].name === '外部方案A', '预览：第一个方案名称正确');
assert(preview1.newSchemes[1].name === '外部方案B', '预览：第二个方案名称正确');

const merge1 = mergeImportSchemes(state, preview1, {});
assert(merge1.success === true, '合并成功');
assert(merge1.newCount === 2, '新增2个方案');
assert(merge1.mergedCount === 0, '无冲突合并');
assert(merge1.blockedCount === 0, '无阻止');
assert(merge1.mergeId !== '', '生成了mergeId');
state = merge1.state;

assert(state.importSchemes.length === 2, '状态中有2个方案');
assert(state.importSchemes.some((s) => s.name === '外部方案A'), '外部方案A已存在');
assert(state.importSchemes.some((s) => s.name === '外部方案B'), '外部方案B已存在');
const schemeA = state.importSchemes.find((s) => s.name === '外部方案A');
assert(schemeA.createdById === 'user-1', '外部方案A创建人为当前用户');
assert(schemeA.isShared === false, '外部方案A默认不共享');
assert(schemeA.isLocked === false, '外部方案A默认不锁定');
assert(schemeA.validationToggles.skipEmptySource === false, '外部方案A保留skipEmptySource=false');
assert(state.schemeMergeLogs.length === 2, '2条合并日志（merge_new）');
assert(state.schemeMergeLogs.every((l) => l.action === 'merge_new'), '所有合并日志action为merge_new');
assert(state.lastSchemeMergeId === merge1.mergeId, 'lastSchemeMergeId已设置');
assert(state.schemeMergeSnapshots.length === 1, '1个合并快照');

console.log('\n【测试2】导入同名方案预览差异 - Preview merge conflicts');
const conflictJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '外部用户',
  schemes: [
    {
      name: '外部方案A',
      columnMappings: [
        { csvColumn: '编号', targetField: 'sampleNo' },
        { csvColumn: '数量', targetField: 'quantity' },
      ],
      defaultBatch: { batchNoPattern: 'NEW-{DATE}', batchNamePattern: '新批次' },
      validationToggles: { ...defaultValidationToggles, skipEmptySource: true },
      isShared: false,
      isLocked: false,
    },
    {
      name: '全新方案C',
      columnMappings: [{ csvColumn: 'ID', targetField: 'sampleNo' }],
      defaultBatch: { batchNoPattern: '', batchNamePattern: '' },
      validationToggles: { ...defaultValidationToggles },
      isShared: false,
      isLocked: false,
    },
  ],
});

const preview2 = previewSchemeMerge(state, conflictJSON);
assert(preview2.totalIncoming === 2, '预览：共2个方案');
assert(preview2.conflictCount === 1, '预览：1个冲突方案');
assert(preview2.newCount === 1, '预览：1个新方案');
assert(preview2.blockedCount === 0, '预览：0个被阻止');

const conflictItem = preview2.conflictItems[0];
assert(conflictItem.existingScheme.name === '外部方案A', '冲突方案名称正确');
assert(conflictItem.canMerge === true, '冲突方案可合并');
assert(conflictItem.blockReason === undefined, '无阻止原因');
assert(conflictItem.fieldDiffs.length === 10, '10个字段差异');

const sameFields = conflictItem.fieldDiffs.filter((d) => d.isSame);
const diffFields = conflictItem.fieldDiffs.filter((d) => !d.isSame);
assert(sameFields.length > 0, '存在相同字段');
assert(diffFields.length > 0, '存在不同字段');

const columnMappingsDiff = conflictItem.fieldDiffs.find((d) => d.fieldName === 'columnMappings');
assert(columnMappingsDiff !== undefined, 'columnMappings差异存在');
assert(columnMappingsDiff.isSame === false, 'columnMappings不同');
assert(columnMappingsDiff.resolution === 'conflict', 'columnMappings标记为conflict');

const batchNoPatternDiff = conflictItem.fieldDiffs.find((d) => d.fieldName === 'defaultBatch.batchNoPattern');
assert(batchNoPatternDiff !== undefined, 'batchNoPattern差异存在');
assert(batchNoPatternDiff.isSame === false, 'batchNoPattern不同');
assert(batchNoPatternDiff.originalValue === 'EXT-{DATE}', 'batchNoPattern原值正确');
assert(batchNoPatternDiff.newValue === 'NEW-{DATE}', 'batchNoPattern新值正确');

const skipEmptySourceDiff = conflictItem.fieldDiffs.find((d) => d.fieldName === 'validationToggles.skipEmptySource');
assert(skipEmptySourceDiff !== undefined, 'skipEmptySource差异存在');
assert(skipEmptySourceDiff.isSame === false, 'skipEmptySource不同');
assert(skipEmptySourceDiff.originalValue === false, 'skipEmptySource原值false');
assert(skipEmptySourceDiff.newValue === true, 'skipEmptySource新值true');

const isSharedDiff = conflictItem.fieldDiffs.find((d) => d.fieldName === 'isShared');
assert(isSharedDiff !== undefined, 'isShared差异存在');
assert(isSharedDiff.isSame === true, 'isShared相同（都为false）');
assert(isSharedDiff.resolution === 'keep_original', 'isSame字段默认keep_original');

const isLockedDiff = conflictItem.fieldDiffs.find((d) => d.fieldName === 'isLocked');
assert(isLockedDiff !== undefined, 'isLocked差异存在');
assert(isLockedDiff.isSame === true, 'isLocked相同（都为false）');

assert(conflictItem.hasUnresolvedConflicts === true, '存在未解决的冲突');

const newSchemeC = preview2.newSchemes[0];
assert(newSchemeC.name === '全新方案C', '新方案名称正确');

console.log('\n【测试3】字段级合并 - Field-level merge');
const resolutions3 = {};
const existingSchemeA = state.importSchemes.find((s) => s.name === '外部方案A');
resolutions3[existingSchemeA.id] = {};
for (const diff of preview2.conflictItems[0].fieldDiffs) {
  if (diff.fieldName === 'defaultBatch.batchNoPattern') {
    resolutions3[existingSchemeA.id][diff.fieldName] = 'use_new';
  } else if (diff.fieldName === 'validationToggles.skipEmptySource') {
    resolutions3[existingSchemeA.id][diff.fieldName] = 'use_new';
  } else if (diff.fieldName === 'columnMappings') {
    resolutions3[existingSchemeA.id][diff.fieldName] = 'keep_original';
  } else if (diff.fieldName === 'defaultBatch.batchNamePattern') {
    resolutions3[existingSchemeA.id][diff.fieldName] = 'keep_original';
  } else {
    resolutions3[existingSchemeA.id][diff.fieldName] = diff.isSame ? 'keep_original' : 'use_new';
  }
}

const merge3 = mergeImportSchemes(state, preview2, resolutions3);
assert(merge3.success === true, '合并成功');
assert(merge3.mergedCount === 1, '合并1个冲突方案');
assert(merge3.newCount === 1, '新增1个方案');
state = merge3.state;

const mergedSchemeA = state.importSchemes.find((s) => s.name === '外部方案A');
assert(mergedSchemeA !== undefined, '合并后的方案A存在');
assert(mergedSchemeA.defaultBatch.batchNoPattern === 'NEW-{DATE}', 'batchNoPattern使用新值');
assert(mergedSchemeA.defaultBatch.batchNamePattern === '外部批次', 'batchNamePattern保留原值');
assert(mergedSchemeA.validationToggles.skipEmptySource === true, 'skipEmptySource使用新值');
assert(mergedSchemeA.columnMappings.length === 1, 'columnMappings保留原值（长度1）');
assert(mergedSchemeA.columnMappings[0].csvColumn === '编号', 'columnMappings保留原列映射');

const schemeC = state.importSchemes.find((s) => s.name === '全新方案C');
assert(schemeC !== undefined, '全新方案C已添加');
assert(schemeC.createdById === 'user-1', '全新方案C创建人为当前用户');

const mergeLogA = state.schemeMergeLogs.find((l) => l.schemeId === existingSchemeA.id && l.action === 'merge');
assert(mergeLogA !== undefined, '方案A有merge日志');
assert(mergeLogA.fieldSources.length === 10, 'merge日志有10个fieldSources');
const batchNoFieldSource = mergeLogA.fieldSources.find((f) => f.fieldName === 'defaultBatch.batchNoPattern');
assert(batchNoFieldSource !== undefined, 'batchNoPattern在fieldSources中');
assert(batchNoFieldSource.source === 'new', 'batchNoPattern来源为new');
const batchNameFieldSource = mergeLogA.fieldSources.find((f) => f.fieldName === 'defaultBatch.batchNamePattern');
assert(batchNameFieldSource.source === 'original', 'batchNamePattern来源为original');

console.log('\n【测试4】撤销最近一次合并 - Undo last merge');
const beforeUndoSchemeCount = state.importSchemes.length;
const beforeUndoMergeId = state.lastSchemeMergeId;
assert(beforeUndoMergeId === merge3.mergeId, '当前lastSchemeMergeId正确');

const undo4 = undoLastSchemeMerge(state);
assert(undo4.success === true, '撤销成功');
state = undo4.state;

assert(state.lastSchemeMergeId === null, '撤销后lastSchemeMergeId清空');
assert(state.importSchemes.length === 2, '撤销后方案数量恢复到2');

const restoredSchemeA = state.importSchemes.find((s) => s.name === '外部方案A');
assert(restoredSchemeA !== undefined, '方案A恢复');
assert(restoredSchemeA.defaultBatch.batchNoPattern === 'EXT-{DATE}', '方案A的batchNoPattern恢复原值');
assert(restoredSchemeA.defaultBatch.batchNamePattern === '外部批次', '方案A的batchNamePattern恢复原值');
assert(restoredSchemeA.validationToggles.skipEmptySource === false, '方案A的skipEmptySource恢复原值');
assert(restoredSchemeA.columnMappings.length === 1, '方案A的columnMappings恢复原值');

assert(!state.importSchemes.some((s) => s.name === '全新方案C'), '新增的方案C已被移除');

const undoLogs = state.schemeMergeLogs.filter((l) => l.action === 'merge_undo');
assert(undoLogs.length > 0, '存在撤销合并日志');

console.log('\n【测试5】再次导入验证 - Re-import verification after undo');
const preview5 = previewSchemeMerge(state, conflictJSON);
assert(preview5.totalIncoming === 2, '再次预览：共2个方案');
assert(preview5.conflictCount === 1, '再次预览：1个冲突');
assert(preview5.newCount === 1, '再次预览：1个新方案');

const resolutions5 = {};
const existingSchemeA5 = state.importSchemes.find((s) => s.name === '外部方案A');
resolutions5[existingSchemeA5.id] = {};
for (const diff of preview5.conflictItems[0].fieldDiffs) {
  resolutions5[existingSchemeA5.id][diff.fieldName] = diff.isSame ? 'keep_original' : 'use_new';
}

const merge5 = mergeImportSchemes(state, preview5, resolutions5);
assert(merge5.success === true, '再次合并成功');
assert(merge5.mergedCount === 1, '再次合并1个冲突');
assert(merge5.newCount === 1, '再次新增1个方案');
state = merge5.state;

const remergedSchemeA = state.importSchemes.find((s) => s.name === '外部方案A');
assert(remergedSchemeA !== undefined, '再次合并后方案A存在');
assert(remergedSchemeA.defaultBatch.batchNoPattern === 'NEW-{DATE}', '再次合并batchNoPattern使用新值');
assert(remergedSchemeA.validationToggles.skipEmptySource === true, '再次合并skipEmptySource使用新值');

const schemeC5 = state.importSchemes.find((s) => s.name === '全新方案C');
assert(schemeC5 !== undefined, '再次合并后方案C存在');

console.log('\n【测试6】持久化验证 - Persistence verification');
const serialized6 = JSON.stringify(state);
const restored6 = JSON.parse(serialized6);

assert(restored6.importSchemes.length === state.importSchemes.length, '重启后方案数量一致');
assert(restored6.schemeMergeLogs.length === state.schemeMergeLogs.length, '重启后合并日志数量一致');
assert(restored6.schemeMergeSnapshots.length === state.schemeMergeSnapshots.length, '重启后合并快照数量一致');
assert(restored6.lastSchemeMergeId === state.lastSchemeMergeId, '重启后lastSchemeMergeId一致');
assert(restored6.operationLog.length === state.operationLog.length, '重启后操作日志数量一致');

const restoredSchemeA6 = restored6.importSchemes.find((s) => s.name === '外部方案A');
assert(restoredSchemeA6.defaultBatch.batchNoPattern === 'NEW-{DATE}', '重启后方案A的batchNoPattern正确');
assert(restoredSchemeA6.validationToggles.skipEmptySource === true, '重启后方案A的skipEmptySource正确');

const mergeLog6 = restored6.schemeMergeLogs.find((l) => l.action === 'merge' && l.schemeName === '外部方案A');
assert(mergeLog6 !== undefined, '重启后合并日志存在');
assert(mergeLog6.fieldSources.length === 10, '重启后合并日志fieldSources完整');

const snapshot6 = restored6.schemeMergeSnapshots[restored6.schemeMergeSnapshots.length - 1];
assert(snapshot6 !== undefined, '重启后快照存在');
assert(snapshot6.originalSchemes.length > 0, '重启后快照originalSchemes非空');

console.log('\n【测试7】只读共享方案拦截 - Read-only shared scheme blocking');
let state7 = createInitialState();
const { state: s7, scheme: scheme7 } = createImportScheme(state7, '共享锁定方案', {
  isShared: true,
  isLocked: true,
  columnMappings: [{ csvColumn: '编号', targetField: 'sampleNo' }],
  defaultBatch: { batchNoPattern: 'LOCK-{DATE}', batchNamePattern: '锁定批次' },
  validationToggles: { ...defaultValidationToggles },
});
state7 = s7;

state7.currentUserId = 'user-2';
assert(canModifyScheme(state7, scheme7) === false, '非创建者不能修改锁定共享方案');

const lockedConflictJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '其他人',
  schemes: [{
    name: '共享锁定方案',
    columnMappings: [{ csvColumn: '新列', targetField: 'sampleNo' }],
    defaultBatch: { batchNoPattern: 'NEW', batchNamePattern: '新名称' },
    validationToggles: { ...defaultValidationToggles, skipEmptySource: false },
    isShared: false,
    isLocked: false,
  }],
});

const preview7 = previewSchemeMerge(state7, lockedConflictJSON);
assert(preview7.conflictCount === 1, '预览：1个冲突');
assert(preview7.blockedCount === 1, '预览：1个被阻止');

const blockedItem7 = preview7.conflictItems[0];
assert(blockedItem7.canMerge === false, '只读共享方案canMerge为false');
assert(blockedItem7.blockReason === '只读共享方案，无法合并', 'blockReason为"只读共享方案，无法合并"');

const resolutions7 = {};
resolutions7[scheme7.id] = {};
for (const diff of blockedItem7.fieldDiffs) {
  resolutions7[scheme7.id][diff.fieldName] = 'use_new';
}
const merge7 = mergeImportSchemes(state7, preview7, resolutions7);
assert(merge7.success === true, '合并操作本身成功（不报错）');
assert(merge7.blockedCount === 1, '1个被阻止');
assert(merge7.mergedCount === 0, '0个被合并');
state7 = merge7.state;

const unchangedScheme7 = state7.importSchemes.find((s) => s.name === '共享锁定方案');
assert(unchangedScheme7.defaultBatch.batchNoPattern === 'LOCK-{DATE}', '锁定方案batchNoPattern未被修改');
assert(unchangedScheme7.isLocked === true, '锁定方案isLocked未被修改');

const blockedLog7 = state7.schemeMergeLogs.find((l) => l.action === 'merge_blocked');
assert(blockedLog7 !== undefined, '存在merge_blocked日志');
assert(blockedLog7.blockReason === '只读共享方案，无法合并', 'blocked日志blockReason正确');

console.log('\n【测试8】无权限覆盖拦截 - No-permission overwrite blocking');
let state8 = createInitialState();
const { state: s8, scheme: scheme8 } = createImportScheme(state8, '权限方案', {
  isShared: true,
  isLocked: true,
  columnMappings: [{ csvColumn: '样本编号', targetField: 'sampleNo' }],
  defaultBatch: { batchNoPattern: 'PERM-{DATE}', batchNamePattern: '权限批次' },
  validationToggles: { ...defaultValidationToggles },
});
state8 = s8;

state8.currentUserId = 'user-2';
assert(canModifyScheme(state8, scheme8) === false, 'canModifyScheme返回false');

const permConflictJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '其他人',
  schemes: [{
    name: '权限方案',
    columnMappings: [{ csvColumn: '篡改列', targetField: 'sampleNo' }],
    defaultBatch: { batchNoPattern: 'HACK', batchNamePattern: '篡改' },
    validationToggles: { ...defaultValidationToggles },
    isShared: false,
    isLocked: false,
  }],
});

const preview8 = previewSchemeMerge(state8, permConflictJSON);
const permConflict = preview8.conflictItems[0];
assert(permConflict.canMerge === false, 'canMerge为false');
assert(permConflict.blockReason === '只读共享方案，无法合并', 'blockReason正确');

console.log('\n【测试9】字段结构不兼容拦截 - Incompatible field structure blocking');
let state9 = createInitialState();
const { state: s9, scheme: scheme9 } = createImportScheme(state9, '兼容方案', {
  columnMappings: [{ csvColumn: '样本编号', targetField: 'sampleNo' }],
  defaultBatch: { batchNoPattern: 'COMP-{DATE}', batchNamePattern: '' },
  validationToggles: { ...defaultValidationToggles },
});
state9 = s9;

const incompatibleJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '外部用户',
  schemes: [{
    name: '兼容方案',
  }],
});

const preview9 = previewSchemeMerge(state9, incompatibleJSON);
assert(preview9.conflictCount === 1, '预览：1个冲突');
assert(preview9.blockedCount === 1, '预览：1个被阻止（字段结构不兼容）');

const incompatibleItem9 = preview9.conflictItems[0];
assert(incompatibleItem9.canMerge === false, '字段不兼容canMerge为false');
assert(incompatibleItem9.blockReason === '字段结构不兼容', 'blockReason为"字段结构不兼容"');

const noColumnMappingsJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '外部用户',
  schemes: [{
    name: '兼容方案',
    defaultBatch: { batchNoPattern: 'X', batchNamePattern: 'Y' },
    validationToggles: { ...defaultValidationToggles },
  }],
});

const preview9b = previewSchemeMerge(state9, noColumnMappingsJSON);
assert(preview9b.conflictItems[0].canMerge === false, '缺少columnMappings时canMerge为false');
assert(preview9b.conflictItems[0].blockReason === '字段结构不兼容', '缺少columnMappings时blockReason正确');

const noValidationTogglesJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '外部用户',
  schemes: [{
    name: '兼容方案',
    columnMappings: [{ csvColumn: '编号', targetField: 'sampleNo' }],
    defaultBatch: { batchNoPattern: 'X', batchNamePattern: 'Y' },
  }],
});

const preview9c = previewSchemeMerge(state9, noValidationTogglesJSON);
assert(preview9c.conflictItems[0].canMerge === false, '缺少validationToggles时canMerge为false');

const noDefaultBatchJSON = JSON.stringify({
  version: 1,
  exportedAt: new Date().toISOString(),
  exportedBy: '外部用户',
  schemes: [{
    name: '兼容方案',
    columnMappings: [{ csvColumn: '编号', targetField: 'sampleNo' }],
    validationToggles: { ...defaultValidationToggles },
  }],
});

const preview9d = previewSchemeMerge(state9, noDefaultBatchJSON);
assert(preview9d.conflictItems[0].canMerge === false, '缺少defaultBatch时canMerge为false');

console.log('\n【测试10】合并日志持久化 - Merge log persistence');
const serialized10 = JSON.stringify(state7);
const restored10 = JSON.parse(serialized10);

assert(restored10.schemeMergeLogs.length === state7.schemeMergeLogs.length, '重启后合并日志数量一致');
for (let i = 0; i < state7.schemeMergeLogs.length; i++) {
  const orig = state7.schemeMergeLogs[i];
  const rest = restored10.schemeMergeLogs[i];
  assert(orig.id === rest.id, `重启后合并日志ID一致[${i}]`);
  assert(orig.mergeId === rest.mergeId, `重启后合并日志mergeId一致[${i}]`);
  assert(orig.schemeId === rest.schemeId, `重启后合并日志schemeId一致[${i}]`);
  assert(orig.action === rest.action, `重启后合并日志action一致[${i}]`);
  assert(orig.operatorName === rest.operatorName, `重启后合并日志operatorName一致[${i}]`);
  if (orig.fieldSources && orig.fieldSources.length > 0) {
    assert(rest.fieldSources.length === orig.fieldSources.length, `重启后fieldSources数量一致[${i}]`);
    for (let j = 0; j < orig.fieldSources.length; j++) {
      assert(orig.fieldSources[j].fieldName === rest.fieldSources[j].fieldName, `重启后fieldSource fieldName一致[${i}][${j}]`);
      assert(orig.fieldSources[j].source === rest.fieldSources[j].source, `重启后fieldSource source一致[${i}][${j}]`);
    }
  }
  if (orig.blockReason) {
    assert(orig.blockReason === rest.blockReason, `重启后blockReason一致[${i}]`);
  }
}

assert(restored10.schemeMergeSnapshots.length === state7.schemeMergeSnapshots.length, '重启后快照数量一致');
const origSnapshot = state7.schemeMergeSnapshots[0];
const restSnapshot = restored10.schemeMergeSnapshots[0];
assert(origSnapshot.mergeId === restSnapshot.mergeId, '重启后快照mergeId一致');
assert(origSnapshot.originalSchemes.length === restSnapshot.originalSchemes.length, '重启后快照originalSchemes数量一致');
assert(origSnapshot.operatorName === restSnapshot.operatorName, '重启后快照operatorName一致');

console.log('\n【测试11】README 验证 - README.md mentions merge functionality');
const readmePath = path.resolve(__dirname, '..', 'README.md');
let readmeExists = false;
let readmeContent = '';
try {
  readmeContent = fs.readFileSync(readmePath, 'utf-8');
  readmeExists = true;
} catch (e) {
  readmeExists = false;
}

if (readmeExists) {
  const hasMerge = readmeContent.includes('合并导入') || readmeContent.toLowerCase().includes('merge');
  assert(hasMerge === true, 'README.md提及"合并导入"或"merge"功能');
} else {
  assert(false, 'README.md文件存在');
}

console.log('\n========== 测试结果 ==========');
if (failures > 0) {
  console.log(`❌ 共 ${failures} 项失败，请修复。\n`);
  process.exit(1);
} else {
  console.log('✅ 全部通过，合并导入功能回归保护生效。\n');
  process.exit(0);
}
