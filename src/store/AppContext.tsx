import React, { createContext, useContext, useReducer, useEffect, ReactNode, useState, useRef } from 'react'
import { AppData, Sample, Batch, HistoryRecord, SampleStatus, User, ImportResult, BatchLedgerEntry, PrevalidateSummary, PrevalidateResult, ImportScheme, SchemeAuditLogEntry, SchemeAuditAction, ConflictResolution, ColumnMapping, ValidationToggles, DefaultBatchInfo, SchemeChangeEvent, SchemeChangeType, OperationLogEntry, OperationLogCategory, ImportTask, ImportTaskStatus, ImportTaskDraftState, TaskAuditLogEntry, TaskAuditAction, ImportRollbackSnapshot, SchemeMergePreview, SchemeMergeFieldDiff, SchemeMergeConflictItem, MergeFieldResolution, SchemeMergeableFieldName, SchemeMergeLogEntry, SchemeMergeSnapshot, SchemeMergeFieldSource } from '../types'
import { v4 as uuidv4 } from 'uuid'

const STORAGE_KEY = 'lab-sample-tracker-data'
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI

interface AppState extends AppData {}

type Action =
  | { type: 'SET_DATA'; payload: AppData }
  | { type: 'SET_CURRENT_USER'; payload: string }
  | { type: 'ADD_BATCH'; payload: Batch }
  | { type: 'ADD_SAMPLE'; payload: Sample }
  | { type: 'UPDATE_SAMPLE'; payload: Sample }
  | { type: 'ADD_HISTORY'; sampleId: string; history: HistoryRecord }
  | { type: 'UNDO_LAST_STATUS'; sampleId: string; history: HistoryRecord; restoreStatus: SampleStatus; clearHandover?: boolean }
  | { type: 'ADD_IMPORT_RESULT'; payload: ImportResult }
  | { type: 'ADD_BATCH_LEDGER_ENTRY'; payload: BatchLedgerEntry }
  | { type: 'ADD_IMPORT_SCHEME'; payload: ImportScheme }
  | { type: 'UPDATE_IMPORT_SCHEME'; payload: ImportScheme }
  | { type: 'DELETE_IMPORT_SCHEME'; schemeId: string }
  | { type: 'ADD_SCHEME_AUDIT_LOG'; payload: SchemeAuditLogEntry }
  | { type: 'SET_LAST_SELECTED_SCHEME'; schemeId: string | null }
  | { type: 'SET_LAST_SCHEME_CHANGE'; payload: SchemeChangeEvent | null }
  | { type: 'CLEAR_LAST_SCHEME_CHANGE' }
  | { type: 'ADD_OPERATION_LOG'; payload: OperationLogEntry }
  | { type: 'ADD_IMPORT_TASK'; payload: ImportTask }
  | { type: 'UPDATE_IMPORT_TASK'; payload: ImportTask }
  | { type: 'DELETE_IMPORT_TASK'; taskId: string }
  | { type: 'ADD_TASK_AUDIT_LOG'; payload: TaskAuditLogEntry }
  | { type: 'SET_LAST_ACTIVE_TASK'; taskId: string | null }
  | { type: 'ADD_ROLLBACK_SNAPSHOT'; payload: ImportRollbackSnapshot }
  | { type: 'REMOVE_SAMPLES_BATCH'; sampleIds: string[]; ledgerIds: string[] }
  | { type: 'SET_LAST_IMPORT_ID'; importId: string | null }
  | { type: 'UPDATE_IMPORT_RESULT'; payload: ImportResult }
  | { type: 'ADD_SCHEME_MERGE_LOG'; payload: SchemeMergeLogEntry }
  | { type: 'SET_LAST_SCHEME_MERGE_ID'; mergeId: string | null }
  | { type: 'ADD_SCHEME_MERGE_SNAPSHOT'; payload: SchemeMergeSnapshot }
  | { type: 'RESTORE_SCHEME_MERGE'; payload: { originalSchemes: ImportScheme[]; addedSchemeIds: string[] } }

const defaultData: AppData = {
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
  schemeMergeLogs: [],
  lastSchemeMergeId: null,
  schemeMergeSnapshots: [],
}

const initialState: AppState = defaultData

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_DATA':
      return action.payload
    case 'SET_CURRENT_USER':
      return { ...state, currentUserId: action.payload }
    case 'ADD_BATCH':
      return { ...state, batches: [...state.batches, action.payload] }
    case 'ADD_SAMPLE':
      return { ...state, samples: [...state.samples, action.payload] }
    case 'UPDATE_SAMPLE':
      return {
        ...state,
        samples: state.samples.map((s) => (s.id === action.payload.id ? action.payload : s)),
      }
    case 'ADD_HISTORY':
      return {
        ...state,
        samples: state.samples.map((s) =>
          s.id === action.sampleId
            ? { ...s, history: [...s.history, action.history] }
            : s
        ),
      }
    case 'UNDO_LAST_STATUS':
      return {
        ...state,
        samples: state.samples.map((s) => {
          if (s.id !== action.sampleId) return s
          const newSample: Sample = {
            ...s,
            status: action.restoreStatus,
            history: [...s.history, action.history],
          }
          if (action.clearHandover) {
            delete newSample.handoverBy
            delete newSample.handoverAt
          }
          return newSample
        }),
      }
    case 'ADD_IMPORT_RESULT':
      return {
        ...state,
        importResults: [...state.importResults, action.payload],
      }
    case 'ADD_BATCH_LEDGER_ENTRY':
      return {
        ...state,
        batchLedger: [...state.batchLedger, action.payload],
      }
    case 'ADD_IMPORT_SCHEME':
      return {
        ...state,
        importSchemes: [...state.importSchemes, action.payload],
      }
    case 'UPDATE_IMPORT_SCHEME':
      return {
        ...state,
        importSchemes: state.importSchemes.map((s) =>
          s.id === action.payload.id ? action.payload : s
        ),
      }
    case 'DELETE_IMPORT_SCHEME':
      return {
        ...state,
        importSchemes: state.importSchemes.filter((s) => s.id !== action.schemeId),
        lastSelectedSchemeId: state.lastSelectedSchemeId === action.schemeId ? null : state.lastSelectedSchemeId,
      }
    case 'ADD_SCHEME_AUDIT_LOG':
      return {
        ...state,
        schemeAuditLog: [...state.schemeAuditLog, action.payload],
      }
    case 'SET_LAST_SELECTED_SCHEME':
      return { ...state, lastSelectedSchemeId: action.schemeId }
    case 'SET_LAST_SCHEME_CHANGE':
      return { ...state, lastSchemeChange: action.payload }
    case 'CLEAR_LAST_SCHEME_CHANGE':
      return { ...state, lastSchemeChange: null }
    case 'ADD_OPERATION_LOG':
      return { ...state, operationLog: [...state.operationLog, action.payload] }
    case 'ADD_IMPORT_TASK':
      return { ...state, importTasks: [...state.importTasks, action.payload] }
    case 'UPDATE_IMPORT_TASK':
      return {
        ...state,
        importTasks: state.importTasks.map((t) =>
          t.id === action.payload.id ? action.payload : t
        ),
      }
    case 'DELETE_IMPORT_TASK':
      return {
        ...state,
        importTasks: state.importTasks.filter((t) => t.id !== action.taskId),
        lastActiveTaskId: state.lastActiveTaskId === action.taskId ? null : state.lastActiveTaskId,
      }
    case 'ADD_TASK_AUDIT_LOG':
      return { ...state, taskAuditLog: [...state.taskAuditLog, action.payload] }
    case 'SET_LAST_ACTIVE_TASK':
      return { ...state, lastActiveTaskId: action.taskId }
    case 'ADD_ROLLBACK_SNAPSHOT':
      return { ...state, rollbackSnapshots: [...state.rollbackSnapshots, action.payload] }
    case 'REMOVE_SAMPLES_BATCH':
      return {
        ...state,
        samples: state.samples.filter((s) => !action.sampleIds.includes(s.id)),
        batchLedger: state.batchLedger.filter((l) => !action.ledgerIds.includes(l.id)),
      }
    case 'SET_LAST_IMPORT_ID':
      return { ...state, lastImportId: action.importId }
    case 'UPDATE_IMPORT_RESULT':
      return {
        ...state,
        importResults: state.importResults.map((r) =>
          r.id === action.payload.id ? action.payload : r
        ),
      }
    case 'ADD_SCHEME_MERGE_LOG':
      return {
        ...state,
        schemeMergeLogs: [...state.schemeMergeLogs, action.payload],
      }
    case 'SET_LAST_SCHEME_MERGE_ID':
      return { ...state, lastSchemeMergeId: action.mergeId }
    case 'ADD_SCHEME_MERGE_SNAPSHOT':
      return {
        ...state,
        schemeMergeSnapshots: [...state.schemeMergeSnapshots, action.payload],
      }
    case 'RESTORE_SCHEME_MERGE':
      return {
        ...state,
        importSchemes: [
          ...state.importSchemes.filter((s) => !action.payload.addedSchemeIds.includes(s.id)),
          ...action.payload.originalSchemes,
        ],
        lastSchemeMergeId: null,
      }
    default:
      return state
  }
}

interface AppContextType {
  state: AppState
  dispatch: React.Dispatch<Action>
  getCurrentUser: () => User | undefined
  createBatch: (batchNo: string, name: string) => Batch
  addSample: (sample: Omit<Sample, 'id' | 'history'>) => { success: boolean; error?: string; sample?: Sample }
  checkDuplicateSampleNo: (sampleNo: string, batchId: string, excludeId?: string) => boolean
  changeSampleStatus: (
    sampleId: string,
    newStatus: SampleStatus,
    action: string,
    reason?: string,
    remark?: string
  ) => { success: boolean; error?: string }
  undoLastStatus: (sampleId: string) => { success: boolean; error?: string }
  canReview: () => boolean
  canModifySample: (sample: Sample) => boolean
  exportHandoverCSV: (batchId?: string) => string
  doExportCSV: (content: string, fileName: string) => Promise<boolean>
  isElectron: boolean
  parseCSV: (content: string) => { sampleNo: string; quantity: string; source: string }[]
  parseCSVWithScheme: (content: string, columnMappings: ColumnMapping[]) => { sampleNo: string; quantity: string; source: string }[]
  prevalidateImportCSV: (batchId: string, csvRows: { sampleNo: string; quantity: string; source: string }[], validationToggles?: ValidationToggles) => PrevalidateSummary
  batchImportSamples: (
    batchId: string,
    validatedRows: PrevalidateResult[],
    opts?: {
      schemeId?: string
      schemeName?: string
      validationToggles?: ValidationToggles
      columnMappings?: ColumnMapping[]
      taskId?: string
    }
  ) => {
    success: boolean
    error?: string
    importResult?: ImportResult
    importedSampleIds?: string[]
  }
  exportBatchLedgerCSV: (batchId?: string) => string
  getBatchLedgerSummary: (batchId: string) => {
    totalSamples: number
    totalActions: number
    byAction: Record<string, number>
    bySample: Record<string, number>
  }
  canModifyScheme: (scheme: ImportScheme) => boolean
  createImportScheme: (name: string, opts?: {
    columnMappings?: ColumnMapping[]
    defaultBatch?: DefaultBatchInfo
    validationToggles?: ValidationToggles
    isShared?: boolean
    isLocked?: boolean
  }) => ImportScheme
  renameImportScheme: (schemeId: string, newName: string) => { success: boolean; error?: string }
  copyImportScheme: (schemeId: string, newName: string) => { success: boolean; error?: string; copiedScheme?: ImportScheme }
  deleteImportScheme: (schemeId: string) => { success: boolean; error?: string }
  modifyImportScheme: (schemeId: string, updates: Partial<ImportScheme>) => { success: boolean; error?: string }
  lockScheme: (schemeId: string) => { success: boolean; error?: string }
  unlockScheme: (schemeId: string) => { success: boolean; error?: string }
  exportSchemesJSON: (schemeIds: string[]) => string
  importSchemesJSON: (jsonString: string, conflictResolution: ConflictResolution) => {
    success: boolean; error?: string; importedCount: number; skippedCount: number; overwrittenCount: number
  }
  setLastSelectedScheme: (schemeId: string | null) => void
  getSchemeAuditLog: (schemeId: string) => SchemeAuditLogEntry[]
  doExportJSON: (content: string, fileName: string) => Promise<boolean>
  resolveDefaultBatch: (pattern: string) => string
  clearLastSchemeChange: () => void
  isLastSelectedSchemeValid: () => boolean
  addOperationLog: (category: OperationLogCategory, action: string, detail?: string, targetId?: string, targetName?: string) => void
  createImportTask: (taskName: string, draftState: Partial<ImportTaskDraftState>) => ImportTask
  updateImportTaskDraft: (taskId: string, draftUpdates: Partial<ImportTaskDraftState>, statusUpdate?: ImportTaskStatus) => { success: boolean; error?: string; task?: ImportTask }
  completeImportTask: (taskId: string, importResultId: string, importResultSnapshot: ImportResult) => { success: boolean; error?: string }
  cancelImportTask: (taskId: string) => { success: boolean; error?: string }
  deleteImportTask: (taskId: string) => { success: boolean; error?: string }
  renameImportTask: (taskId: string, newName: string) => { success: boolean; error?: string }
  revertLastImport: (reason?: string) => { success: boolean; error?: string; revertedCount?: number }
  canRevertLastImport: () => boolean
  getLastImportSnapshot: () => ImportRollbackSnapshot | null
  getTaskAuditLog: (taskId: string) => TaskAuditLogEntry[]
  addTaskAuditLog: (taskId: string, taskName: string, action: TaskAuditAction, detail?: string) => void
  canModifyTask: (task: ImportTask) => boolean
  setLastActiveTask: (taskId: string | null) => void
  buildImportValidationPipeline: (
    batchId: string,
    csvContent: string,
    schemeId: string | null
  ) => {
    parsedRows: { sampleNo: string; quantity: string; source: string }[]
    validationToggles: ValidationToggles
    columnMappings: ColumnMapping[]
    prevalidateSummary: PrevalidateSummary
  }
  previewSchemeMerge: (jsonString: string) => SchemeMergePreview
  mergeImportSchemes: (
    preview: SchemeMergePreview,
    conflictResolutions: Record<string, Record<SchemeMergeableFieldName, MergeFieldResolution>>
  ) => {
    success: boolean
    error?: string
    mergedCount: number
    newCount: number
    blockedCount: number
    mergeId: string
  }
  undoLastSchemeMerge: () => { success: boolean; error?: string }
  canUndoLastSchemeMerge: () => boolean
  getSchemeMergeLog: (schemeId: string) => SchemeMergeLogEntry[]
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const isLoadedRef = useRef(false)
  const fallbackToLocalStorage = useRef(false)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (isLoadedRef.current) {
      persistData(state)
    }
  }, [state])

  const mergeWithDefaults = (data: Partial<AppData>): AppData => {
    const merged: AppData = {
      ...defaultData,
      ...data,
      importResults: data.importResults || [],
      batchLedger: data.batchLedger || [],
      importSchemes: data.importSchemes || [],
      schemeAuditLog: data.schemeAuditLog || [],
      lastSelectedSchemeId: data.lastSelectedSchemeId || null,
      lastSchemeChange: data.lastSchemeChange || null,
      operationLog: data.operationLog || [],
      importTasks: (data.importTasks || []).map((t) => ({
        ...t,
        draftState: t.draftState || {
          csvContent: null, fileName: null, selectedBatchId: null,
          selectedSchemeId: null, columnMappings: null, validationToggles: null,
          prevalidateSummary: null, parsedRows: null,
        },
      })),
      taskAuditLog: data.taskAuditLog || [],
      lastActiveTaskId: data.lastActiveTaskId || null,
      rollbackSnapshots: data.rollbackSnapshots || [],
      lastImportId: data.lastImportId || null,
      schemeMergeLogs: data.schemeMergeLogs || [],
      lastSchemeMergeId: data.lastSchemeMergeId || null,
      schemeMergeSnapshots: data.schemeMergeSnapshots || [],
      samples: (data.samples || []).map((s) => ({
        ...s,
        history: s.history || [],
      })),
    }

    if (merged.lastSelectedSchemeId) {
      const schemeExists = merged.importSchemes.some((s) => s.id === merged.lastSelectedSchemeId)
      if (!schemeExists) {
        merged.lastSelectedSchemeId = null
      }
    }

    if (merged.lastActiveTaskId) {
      const taskExists = merged.importTasks.some((t) => t.id === merged.lastActiveTaskId)
      if (!taskExists) {
        merged.lastActiveTaskId = null
      }
    }

    return merged
  }

  const loadData = async () => {
    try {
      if (isElectron && !fallbackToLocalStorage.current) {
        const data = await (window as any).electronAPI.getData()
        dispatch({ type: 'SET_DATA', payload: mergeWithDefaults(data) })
      } else {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
          const data = JSON.parse(stored)
          dispatch({ type: 'SET_DATA', payload: mergeWithDefaults(data) })
        } else {
          dispatch({ type: 'SET_DATA', payload: defaultData })
        }
      }
    } catch (e) {
      console.error('加载数据失败，降级到 localStorage', e)
      fallbackToLocalStorage.current = true
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        dispatch({ type: 'SET_DATA', payload: mergeWithDefaults(data) })
      } else {
        dispatch({ type: 'SET_DATA', payload: defaultData })
      }
    } finally {
      setTimeout(() => {
        isLoadedRef.current = true
      }, 0)
    }
  }

  const persistData = async (data: AppData) => {
    try {
      if (isElectron && !fallbackToLocalStorage.current) {
        await (window as any).electronAPI.saveData(data)
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      }
    } catch (e) {
      console.error('保存数据失败，降级到 localStorage', e)
      fallbackToLocalStorage.current = true
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
  }

  const doExportCSV = async (content: string, fileName: string): Promise<boolean> => {
    try {
      if (isElectron && !fallbackToLocalStorage.current) {
        return await (window as any).electronAPI.exportCSV(content, fileName)
      } else {
        const BOM = '\uFEFF'
        const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        return true
      }
    } catch (e) {
      console.error('导出失败', e)
      return false
    }
  }

  const getCurrentUser = (): User | undefined => {
    return state.users.find((u) => u.id === state.currentUserId)
  }

  const createBatch = (batchNo: string, name: string): Batch => {
    const user = getCurrentUser()
    const batch: Batch = {
      id: uuidv4(),
      batchNo,
      name,
      createdAt: new Date().toISOString(),
      createdBy: user?.username || '未知',
    }
    dispatch({ type: 'ADD_BATCH', payload: batch })
    addOperationLog('batch', '创建批次', `创建批次：${batchNo}${name ? ' - ' + name : ''}`, batch.id, batchNo)
    return batch
  }

  const checkDuplicateSampleNo = (sampleNo: string, batchId: string, excludeId?: string): boolean => {
    return state.samples.some(
      (s) => s.batchId === batchId && s.sampleNo === sampleNo && s.id !== excludeId
    )
  }

  const addSample = (sampleData: Omit<Sample, 'id' | 'history'>): { success: boolean; error?: string; sample?: Sample; ledgerEntryId?: string } => {
    if (checkDuplicateSampleNo(sampleData.sampleNo, sampleData.batchId)) {
      return { success: false, error: '同一批次中已存在相同的样本编号，无法保存' }
    }

    const user = getCurrentUser()
    const sample: Sample = {
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
    }
    sample.history[0].sampleId = sample.id

    dispatch({ type: 'ADD_SAMPLE', payload: sample })

    const ledgerEntry: BatchLedgerEntry = {
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
    }
    dispatch({ type: 'ADD_BATCH_LEDGER_ENTRY', payload: ledgerEntry })

    return { success: true, sample, ledgerEntryId: ledgerEntry.id }
  }

  const canReview = (): boolean => {
    const user = getCurrentUser()
    return user?.role === 'reviewer'
  }

  const canModifySample = (sample: Sample): boolean => {
    if (sample.status === 'reviewed') {
      const user = getCurrentUser()
      return user?.role === 'reviewer'
    }
    return true
  }

  const changeSampleStatus = (
    sampleId: string,
    newStatus: SampleStatus,
    action: string,
    reason?: string,
    remark?: string
  ): { success: boolean; error?: string } => {
    const sample = state.samples.find((s) => s.id === sampleId)
    if (!sample) return { success: false, error: '样本不存在' }

    if (!canModifySample(sample)) {
      return {
        success: false,
        error: '普通操作员不能修改已复核通过的交接记录，请联系复核员',
      }
    }

    if (newStatus === 'reviewed' && !canReview()) {
      return { success: false, error: '普通操作员不能执行复核通过操作，请联系复核员' }
    }

    const user = getCurrentUser()
    const history: HistoryRecord = {
      id: uuidv4(),
      sampleId,
      action,
      operatorId: state.currentUserId || '',
      operatorName: user?.username || '未知',
      timestamp: new Date().toISOString(),
      fromStatus: sample.status,
      toStatus: newStatus,
      reason,
      remark,
    }

    const updatedSample: Sample = {
      ...sample,
      status: newStatus,
      history: [...sample.history, history],
    }

    if (newStatus === 'reviewed') {
      updatedSample.handoverBy = user?.username || '未知'
      updatedSample.handoverAt = new Date().toISOString()
    }

    dispatch({ type: 'UPDATE_SAMPLE', payload: updatedSample })

    const ledgerEntry: BatchLedgerEntry = {
      id: uuidv4(),
      batchId: sample.batchId,
      sampleId: sample.id,
      sampleNo: sample.sampleNo,
      action,
      operatorId: state.currentUserId || '',
      operatorName: user?.username || '未知',
      timestamp: history.timestamp,
      fromStatus: sample.status,
      toStatus: newStatus,
      reason,
      remark,
    }
    dispatch({ type: 'ADD_BATCH_LEDGER_ENTRY', payload: ledgerEntry })

    return { success: true }
  }

  const undoLastStatus = (sampleId: string): { success: boolean; error?: string } => {
    const sample = state.samples.find((s) => s.id === sampleId)
    if (!sample) return { success: false, error: '样本不存在' }

    if (!canModifySample(sample) && sample.status !== 'returned') {
      return {
        success: false,
        error: '普通操作员不能修改已复核通过的交接记录',
      }
    }

    if (sample.history.length < 2) {
      return { success: false, error: '该样本尚无状态变更记录，无法撤销' }
    }
    if (sample.status === 'returned') {
      const returnHistory = sample.history[sample.history.length - 1]
      const restoreStatus = returnHistory.fromStatus as SampleStatus
      const user = getCurrentUser()
      const undoHistory: HistoryRecord = {
        id: uuidv4(),
        sampleId,
        action: '撤销退回',
        operatorId: state.currentUserId || '',
        operatorName: user?.username || '未知',
        timestamp: new Date().toISOString(),
        fromStatus: 'returned',
        toStatus: restoreStatus,
        reason: `撤销原退回操作（原退回原因：${returnHistory.reason || '未填写'}）`,
      }
      dispatch({
        type: 'UNDO_LAST_STATUS',
        sampleId,
        history: undoHistory,
        restoreStatus,
        clearHandover: restoreStatus === 'reviewing' || restoreStatus === 'aliquoted' || restoreStatus === 'received',
      })

      const ledgerEntry: BatchLedgerEntry = {
        id: uuidv4(),
        batchId: sample.batchId,
        sampleId: sample.id,
        sampleNo: sample.sampleNo,
        action: '撤销退回',
        operatorId: state.currentUserId || '',
        operatorName: user?.username || '未知',
        timestamp: undoHistory.timestamp,
        fromStatus: 'returned',
        toStatus: restoreStatus,
        reason: undoHistory.reason,
      }
      dispatch({ type: 'ADD_BATCH_LEDGER_ENTRY', payload: ledgerEntry })

      return { success: true }
    }
    return { success: false, error: '仅退回状态可撤销最近一次变更' }
  }

  const exportHandoverCSV = (batchId?: string): string => {
    const samples = batchId
      ? state.samples.filter((s) => s.batchId === batchId && s.status === 'reviewed')
      : state.samples.filter((s) => s.status === 'reviewed')

    const headers = ['样本编号', '所属批次', '数量', '来源', '接收时间', '接收人', '交接人', '交接时间', '状态']
    const rows = samples.map((s) => {
      const batch = state.batches.find((b) => b.id === s.batchId)
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
      ]
    })

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    return csvContent
  }

  const parseCSV = (content: string): { sampleNo: string; quantity: string; source: string }[] => {
    const lines = content.split('\n').filter((line) => line.trim() !== '')
    const result: { sampleNo: string; quantity: string; source: string }[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (i === 0 && (line.includes('样本编号') || line.includes('sampleNo') || line.includes('SampleNo'))) {
        continue
      }
      const values = line.split(',').map((v) => v.trim())
      if (values.length >= 3) {
        result.push({
          sampleNo: values[0],
          quantity: values[1],
          source: values[2],
        })
      } else if (values.length === 2) {
        result.push({
          sampleNo: values[0],
          quantity: values[1],
          source: '',
        })
      } else if (values.length === 1) {
        result.push({
          sampleNo: values[0],
          quantity: '',
          source: '',
        })
      }
    }
    return result
  }

  const parseCSVWithScheme = (content: string, columnMappings: ColumnMapping[]): { sampleNo: string; quantity: string; source: string }[] => {
    const lines = content.split('\n').filter((line) => line.trim() !== '')
    if (lines.length === 0) return []

    const firstLineCells = lines[0].split(',').map((v) => v.trim())

    const colIndexMap: Record<string, number> = {}
    let headerFound = false
    for (const mapping of columnMappings) {
      const idx = firstLineCells.findIndex((h) => h === mapping.csvColumn)
      if (idx !== -1) {
        colIndexMap[mapping.targetField] = idx
        headerFound = true
      }
    }

    if (!headerFound) {
      const defaultHeaders = ['样本编号', 'sampleNo', 'SampleNo', '编号']
      for (let i = 0; i < firstLineCells.length; i++) {
        if (defaultHeaders.some((h) => firstLineCells[i].includes(h))) {
          headerFound = true
          break
        }
      }
    }

    const startIdx = headerFound ? 1 : 0
    const result: { sampleNo: string; quantity: string; source: string }[] = []

    for (let i = startIdx; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim())

      if (headerFound && Object.keys(colIndexMap).length > 0) {
        result.push({
          sampleNo: colIndexMap['sampleNo'] !== undefined ? (values[colIndexMap['sampleNo']] || '') : (values[0] || ''),
          quantity: colIndexMap['quantity'] !== undefined ? (values[colIndexMap['quantity']] || '') : (values[1] || ''),
          source: colIndexMap['source'] !== undefined ? (values[colIndexMap['source']] || '') : (values[2] || ''),
        })
      } else {
        if (values.length >= 3) {
          result.push({ sampleNo: values[0], quantity: values[1], source: values[2] })
        } else if (values.length === 2) {
          result.push({ sampleNo: values[0], quantity: values[1], source: '' })
        } else if (values.length === 1) {
          result.push({ sampleNo: values[0], quantity: '', source: '' })
        }
      }
    }

    return result
  }

  const prevalidateImportCSV = (
    batchId: string,
    csvRows: { sampleNo: string; quantity: string; source: string }[],
    validationToggles?: ValidationToggles
  ): PrevalidateSummary => {
    const toggles = validationToggles || {
      skipEmptySampleNo: true,
      skipDuplicateInFile: true,
      skipDuplicateInBatch: true,
      skipInvalidQuantity: true,
      skipEmptySource: true,
    }
    const seenSampleNos = new Set<string>()
    const results: PrevalidateResult[] = csvRows.map((row, idx) => {
      const errors: string[] = []
      const warnings: string[] = []
      const cleanSampleNo = row.sampleNo.trim()

      if (!toggles.skipEmptySampleNo && !cleanSampleNo) {
        errors.push('样本编号不能为空')
      }
      if (!toggles.skipInvalidQuantity && (!row.quantity || isNaN(parseInt(row.quantity)) || parseInt(row.quantity) < 1)) {
        errors.push('数量必须为大于0的数字')
      }
      if (!toggles.skipEmptySource && !row.source.trim()) {
        errors.push('样本来源不能为空')
      }

      if (cleanSampleNo) {
        if (!toggles.skipDuplicateInFile && seenSampleNos.has(cleanSampleNo)) {
          errors.push(`CSV文件内存在重复的样本编号: ${cleanSampleNo}`)
        }
        seenSampleNos.add(cleanSampleNo)

        if (!toggles.skipDuplicateInBatch && checkDuplicateSampleNo(cleanSampleNo, batchId)) {
          errors.push(`该批次中已存在样本编号: ${cleanSampleNo}`)
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
      }
    })

    const validCount = results.filter((r) => r.valid).length
    const invalidCount = results.filter((r) => !r.valid).length

    return {
      total: csvRows.length,
      validCount,
      invalidCount,
      canImport: validCount > 0,
      results,
    }
  }

  const batchImportSamples = (
    batchId: string,
    validatedRows: PrevalidateResult[],
    opts?: {
      schemeId?: string
      schemeName?: string
      validationToggles?: ValidationToggles
      columnMappings?: ColumnMapping[]
      taskId?: string
    }
  ): {
    success: boolean
    error?: string
    importResult?: ImportResult
    importedSampleIds?: string[]
  } => {
    const skipDupCheck = opts?.validationToggles?.skipDuplicateInFile === true
    const validRows = validatedRows.filter((r) => r.valid)
    const invalidRows = validatedRows.filter((r) => !r.valid)
    const importId = uuidv4()
    const importedSampleIds: string[] = []
    const importedLedgerIds: string[] = []
    const importedHistories: HistoryRecord[] = []

    const user = getCurrentUser()
    const importResult: ImportResult = {
      id: importId,
      batchId,
      timestamp: new Date().toISOString(),
      operatorId: state.currentUserId || '',
      operatorName: user?.username || '未知',
      totalCount: validatedRows.length,
      successCount: 0,
      failedCount: 0,
      details: [],
      schemeId: opts?.schemeId,
      schemeName: opts?.schemeName,
      validationToggles: opts?.validationToggles,
      columnMappings: opts?.columnMappings,
    }

    for (const row of invalidRows) {
      importResult.failedCount++
      importResult.details.push({
        rowIndex: row.rowIndex,
        sampleNo: row.sampleNo,
        success: false,
        error: row.errors[0] || '预检失败',
      })
    }

    const importedInThisBatch = new Map<string, string>()

    for (const row of validRows) {
      try {
        if (skipDupCheck && importedInThisBatch.has(row.sampleNo)) {
          const existingSampleId = importedInThisBatch.get(row.sampleNo)!
          const existingSample = state.samples.find((s) => s.id === existingSampleId)
          if (existingSample) {
            importedSampleIds.push(existingSample.id)
            importResult.successCount++
            importResult.details.push({
              rowIndex: row.rowIndex,
              sampleNo: row.sampleNo,
              success: true,
            })
            continue
          }
        }

        const result = addSample({
          batchId,
          sampleNo: row.sampleNo,
          quantity: parseInt(row.quantity || '1') || 1,
          source: row.source?.trim() || '',
          status: 'received',
          receivedAt: new Date().toISOString(),
          receivedBy: user?.username || '未知',
        })

        if (result.success && result.sample) {
          importedSampleIds.push(result.sample.id)
          importedInThisBatch.set(row.sampleNo, result.sample.id)
          if (result.ledgerEntryId) {
            importedLedgerIds.push(result.ledgerEntryId)
          }
          if (result.sample.history && result.sample.history.length > 0) {
            importedHistories.push(result.sample.history[0])
          }
          importResult.successCount++
          importResult.details.push({
            rowIndex: row.rowIndex,
            sampleNo: row.sampleNo,
            success: true,
          })
        } else {
          importResult.failedCount++
          importResult.details.push({
            rowIndex: row.rowIndex,
            sampleNo: row.sampleNo,
            success: false,
            error: result.error || '导入失败',
          })
        }
      } catch (e) {
        importResult.failedCount++
        importResult.details.push({
          rowIndex: row.rowIndex,
          sampleNo: row.sampleNo,
          success: false,
          error: e instanceof Error ? e.message : '未知错误',
        })
      }
    }

    dispatch({ type: 'ADD_IMPORT_RESULT', payload: importResult })
    dispatch({ type: 'SET_LAST_IMPORT_ID', importId })

    if (importedSampleIds.length > 0) {
      const snapshot: ImportRollbackSnapshot = {
        importResultId: importId,
        taskId: opts?.taskId || null,
        removedSampleIds: importedSampleIds,
        removedBatchLedgerIds: importedLedgerIds,
        removedSampleHistories: importedHistories,
        createdAt: new Date().toISOString(),
        createdBy: user?.username || '未知',
        createdById: state.currentUserId || '',
      }
      dispatch({ type: 'ADD_ROLLBACK_SNAPSHOT', payload: snapshot })
    }

    const batch = state.batches.find((b) => b.id === batchId)
    addOperationLog(
      'import',
      '批量导入',
      `批次${batch?.batchNo || batchId}：成功${importResult.successCount}条，失败${importResult.failedCount}条${opts?.schemeName ? '，方案：' + opts.schemeName : ''}`,
      importId,
      batch?.batchNo
    )

    return {
      success: true,
      importResult,
      importedSampleIds,
    }
  }

  const exportBatchLedgerCSV = (batchId?: string): string => {
    const ledgerEntries = batchId
      ? state.batchLedger.filter((l) => l.batchId === batchId)
      : state.batchLedger

    const sortedEntries = [...ledgerEntries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    const headers = ['时间', '批次号', '样本编号', '动作', '操作人', '原状态', '新状态', '原因', '备注']
    const STATUS_LABELS_MAP: Record<string, string> = {
      received: '已接收',
      aliquoted: '已分装',
      reviewing: '待复核',
      reviewed: '已复核通过',
      returned: '已退回',
    }
    const rows = sortedEntries.map((l) => {
      const batch = state.batches.find((b) => b.id === l.batchId)
      return [
        new Date(l.timestamp).toLocaleString('zh-CN'),
        batch?.batchNo || '',
        l.sampleNo,
        l.action,
        l.operatorName,
        l.fromStatus ? STATUS_LABELS_MAP[l.fromStatus] || l.fromStatus : '无',
        STATUS_LABELS_MAP[l.toStatus] || l.toStatus,
        l.reason || '',
        l.remark || '',
      ]
    })

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  }

  const getBatchLedgerSummary = (
    batchId: string
  ): {
    totalSamples: number
    totalActions: number
    byAction: Record<string, number>
    bySample: Record<string, number>
  } => {
    const batchLedgerEntries = state.batchLedger.filter((l) => l.batchId === batchId)
    const batchSamples = state.samples.filter((s) => s.batchId === batchId)
    const stats: {
      totalSamples: number
      totalActions: number
      byAction: Record<string, number>
      bySample: Record<string, number>
    } = {
      totalSamples: batchSamples.length,
      totalActions: batchLedgerEntries.length,
      byAction: {},
      bySample: {},
    }
    batchLedgerEntries.forEach((l) => {
      stats.byAction[l.action] = (stats.byAction[l.action] || 0) + 1
      stats.bySample[l.sampleNo] = (stats.bySample[l.sampleNo] || 0) + 1
    })
    return stats
  }

  const defaultValidationToggles: ValidationToggles = {
    skipEmptySampleNo: true,
    skipDuplicateInFile: true,
    skipDuplicateInBatch: true,
    skipInvalidQuantity: true,
    skipEmptySource: true,
  }

  const canModifyScheme = (scheme: ImportScheme): boolean => {
    if (scheme.isLocked && scheme.isShared && scheme.createdById !== state.currentUserId) {
      return false
    }
    return true
  }

  const addSchemeAuditLog = (schemeId: string, schemeName: string, action: SchemeAuditAction, detail?: string) => {
    const user = getCurrentUser()
    const entry: SchemeAuditLogEntry = {
      id: uuidv4(),
      schemeId,
      schemeName,
      action,
      operatorId: state.currentUserId || '',
      operatorName: user?.username || '未知',
      timestamp: new Date().toISOString(),
      detail,
    }
    dispatch({ type: 'ADD_SCHEME_AUDIT_LOG', payload: entry })
  }

  const emitSchemeChange = (type: SchemeChangeType, schemeId: string, schemeName: string, extra?: { oldName?: string; detail?: string }) => {
    const affectedLastSelected = state.lastSelectedSchemeId === schemeId
    dispatch({
      type: 'SET_LAST_SCHEME_CHANGE',
      payload: {
        type,
        schemeId,
        schemeName,
        oldName: extra?.oldName,
        timestamp: new Date().toISOString(),
        detail: extra?.detail,
        affectedLastSelected,
      },
    })
  }

  const clearLastSchemeChange = () => {
    dispatch({ type: 'CLEAR_LAST_SCHEME_CHANGE' })
  }

  const isLastSelectedSchemeValid = (): boolean => {
    if (!state.lastSelectedSchemeId) return false
    return state.importSchemes.some((s) => s.id === state.lastSelectedSchemeId)
  }

  const addOperationLog = (category: OperationLogCategory, action: string, detail?: string, targetId?: string, targetName?: string) => {
    const user = getCurrentUser()
    const entry: OperationLogEntry = {
      id: uuidv4(),
      category,
      action,
      operatorId: state.currentUserId || '',
      operatorName: user?.username || '未知',
      timestamp: new Date().toISOString(),
      detail,
      targetId,
      targetName,
    }
    dispatch({ type: 'ADD_OPERATION_LOG', payload: entry })
  }

  const createImportScheme = (name: string, opts?: {
    columnMappings?: ColumnMapping[]
    defaultBatch?: DefaultBatchInfo
    validationToggles?: ValidationToggles
    isShared?: boolean
    isLocked?: boolean
  }): ImportScheme => {
    const user = getCurrentUser()
    const scheme: ImportScheme = {
      id: uuidv4(),
      name,
      columnMappings: opts?.columnMappings || [
        { csvColumn: '样本编号', targetField: 'sampleNo' },
        { csvColumn: '数量', targetField: 'quantity' },
        { csvColumn: '来源', targetField: 'source' },
      ],
      defaultBatch: opts?.defaultBatch || { batchNoPattern: '', batchNamePattern: '' },
      validationToggles: opts?.validationToggles || { ...defaultValidationToggles },
      isShared: opts?.isShared || false,
      isLocked: opts?.isLocked || false,
      createdBy: user?.username || '未知',
      createdById: state.currentUserId || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    dispatch({ type: 'ADD_IMPORT_SCHEME', payload: scheme })
    addSchemeAuditLog(scheme.id, scheme.name, 'create', '创建导入方案')
    emitSchemeChange('create', scheme.id, scheme.name, { detail: '创建导入方案' })
    return scheme
  }

  const renameImportScheme = (schemeId: string, newName: string): { success: boolean; error?: string } => {
    const scheme = state.importSchemes.find((s) => s.id === schemeId)
    if (!scheme) return { success: false, error: '方案不存在' }
    if (!canModifyScheme(scheme)) return { success: false, error: '无权修改此方案（他人锁定共享方案）' }
    const oldName = scheme.name
    const updated: ImportScheme = { ...scheme, name: newName, updatedAt: new Date().toISOString() }
    dispatch({ type: 'UPDATE_IMPORT_SCHEME', payload: updated })
    addSchemeAuditLog(schemeId, newName, 'rename', `方案重命名：${oldName} → ${newName}`)
    emitSchemeChange('rename', schemeId, newName, { oldName, detail: `方案重命名：${oldName} → ${newName}` })
    return { success: true }
  }

  const copyImportScheme = (schemeId: string, newName: string): { success: boolean; error?: string; copiedScheme?: ImportScheme } => {
    const scheme = state.importSchemes.find((s) => s.id === schemeId)
    if (!scheme) return { success: false, error: '方案不存在' }
    const user = getCurrentUser()
    const copied: ImportScheme = {
      ...scheme,
      id: uuidv4(),
      name: newName,
      isShared: false,
      isLocked: false,
      createdBy: user?.username || '未知',
      createdById: state.currentUserId || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    dispatch({ type: 'ADD_IMPORT_SCHEME', payload: copied })
    addSchemeAuditLog(copied.id, newName, 'copy', `从方案「${scheme.name}」复制`)
    emitSchemeChange('create', copied.id, newName, { detail: `从方案「${scheme.name}」复制` })
    return { success: true, copiedScheme: copied }
  }

  const deleteImportScheme = (schemeId: string): { success: boolean; error?: string } => {
    const scheme = state.importSchemes.find((s) => s.id === schemeId)
    if (!scheme) return { success: false, error: '方案不存在' }
    if (!canModifyScheme(scheme)) return { success: false, error: '无权删除此方案（他人锁定共享方案）' }
    dispatch({ type: 'DELETE_IMPORT_SCHEME', schemeId })
    addSchemeAuditLog(schemeId, scheme.name, 'delete', `删除方案「${scheme.name}」`)
    emitSchemeChange('delete', schemeId, scheme.name, { detail: `删除方案「${scheme.name}」` })
    return { success: true }
  }

  const modifyImportScheme = (schemeId: string, updates: Partial<ImportScheme>): { success: boolean; error?: string } => {
    const scheme = state.importSchemes.find((s) => s.id === schemeId)
    if (!scheme) return { success: false, error: '方案不存在' }
    if (!canModifyScheme(scheme)) return { success: false, error: '无权修改此方案（他人锁定共享方案）' }
    const updated: ImportScheme = { ...scheme, ...updates, updatedAt: new Date().toISOString() }
    dispatch({ type: 'UPDATE_IMPORT_SCHEME', payload: updated })
    addSchemeAuditLog(schemeId, updated.name, 'modify', '修改方案配置')
    emitSchemeChange('update', schemeId, updated.name, { detail: '修改方案配置' })
    return { success: true }
  }

  const lockScheme = (schemeId: string): { success: boolean; error?: string } => {
    const scheme = state.importSchemes.find((s) => s.id === schemeId)
    if (!scheme) return { success: false, error: '方案不存在' }
    if (scheme.createdById !== state.currentUserId) return { success: false, error: '只有方案创建者才能锁定' }
    const updated: ImportScheme = { ...scheme, isLocked: true, isShared: true, updatedAt: new Date().toISOString() }
    dispatch({ type: 'UPDATE_IMPORT_SCHEME', payload: updated })
    addSchemeAuditLog(schemeId, scheme.name, 'lock', '锁定共享方案')
    emitSchemeChange('lock', schemeId, scheme.name, { detail: '锁定共享方案' })
    return { success: true }
  }

  const unlockScheme = (schemeId: string): { success: boolean; error?: string } => {
    const scheme = state.importSchemes.find((s) => s.id === schemeId)
    if (!scheme) return { success: false, error: '方案不存在' }
    if (scheme.createdById !== state.currentUserId) return { success: false, error: '只有方案创建者才能解锁' }
    const updated: ImportScheme = { ...scheme, isLocked: false, updatedAt: new Date().toISOString() }
    dispatch({ type: 'UPDATE_IMPORT_SCHEME', payload: updated })
    addSchemeAuditLog(schemeId, scheme.name, 'unlock', '解锁方案')
    emitSchemeChange('unlock', schemeId, scheme.name, { detail: '解锁方案' })
    return { success: true }
  }

  const exportSchemesJSON = (schemeIds: string[]): string => {
    const schemes = state.importSchemes.filter((s) => schemeIds.includes(s.id))
    const user = getCurrentUser()
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: user?.username || '未知',
      schemes,
    }
    for (const s of schemes) {
      addSchemeAuditLog(s.id, s.name, 'export', '导出方案')
    }
    addOperationLog('scheme', '导出方案', `导出${schemes.length}个方案`, undefined, schemes.map(s => s.name).join('、'))
    return JSON.stringify(exportData, null, 2)
  }

  const importSchemesJSON = (jsonString: string, conflictResolution: ConflictResolution): {
    success: boolean; error?: string; importedCount: number; skippedCount: number; overwrittenCount: number
  } => {
    let importData: { version: number; exportedAt: string; exportedBy: string; schemes: ImportScheme[] }
    try {
      importData = JSON.parse(jsonString)
    } catch {
      return { success: false, error: 'JSON格式无效', importedCount: 0, skippedCount: 0, overwrittenCount: 0 }
    }
    if (!importData.schemes || !Array.isArray(importData.schemes)) {
      return { success: false, error: '导入数据缺少schemes字段', importedCount: 0, skippedCount: 0, overwrittenCount: 0 }
    }

    let importedCount = 0
    let skippedCount = 0
    let overwrittenCount = 0
    const user = getCurrentUser()

    for (const scheme of importData.schemes) {
      const existingByName = state.importSchemes.find((s) => s.name === scheme.name)
      if (existingByName) {
        if (conflictResolution === 'skip') {
          skippedCount++
          continue
        } else if (conflictResolution === 'overwrite') {
          if (!canModifyScheme(existingByName)) {
            skippedCount++
            continue
          }
          const updated: ImportScheme = {
            ...scheme,
            id: existingByName.id,
            createdById: existingByName.createdById,
            createdBy: existingByName.createdBy,
            isLocked: existingByName.isLocked,
            isShared: existingByName.isShared,
            updatedAt: new Date().toISOString(),
          }
          dispatch({ type: 'UPDATE_IMPORT_SCHEME', payload: updated })
          overwrittenCount++
          addSchemeAuditLog(existingByName.id, scheme.name, 'import', `导入覆盖方案「${scheme.name}」`)
          emitSchemeChange('overwrite', existingByName.id, scheme.name, { detail: `导入覆盖方案「${scheme.name}」` })
          continue
        }
      }
      const newScheme: ImportScheme = {
        ...scheme,
        id: uuidv4(),
        createdBy: user?.username || '未知',
        createdById: state.currentUserId || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isShared: false,
        isLocked: false,
      }
      dispatch({ type: 'ADD_IMPORT_SCHEME', payload: newScheme })
      importedCount++
      addSchemeAuditLog(newScheme.id, newScheme.name, 'import', `导入新方案「${newScheme.name}」`)
      emitSchemeChange('import', newScheme.id, newScheme.name, { detail: `导入新方案「${newScheme.name}」` })
    }

    addOperationLog('scheme', '导入方案', `导入完成：新增${importedCount}，覆盖${overwrittenCount}，跳过${skippedCount}`)

    return { success: true, importedCount, skippedCount, overwrittenCount }
  }

  const setLastSelectedScheme = (schemeId: string | null) => {
    dispatch({ type: 'SET_LAST_SELECTED_SCHEME', schemeId })
  }

  const getSchemeAuditLog = (schemeId: string): SchemeAuditLogEntry[] => {
    return state.schemeAuditLog.filter((l) => l.schemeId === schemeId)
  }

  const doExportJSON = async (content: string, fileName: string): Promise<boolean> => {
    try {
      if (isElectron && !fallbackToLocalStorage.current) {
        return await (window as any).electronAPI.exportJSON(content, fileName)
      } else {
        const blob = new Blob([content], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        return true
      }
    } catch {
      return false
    }
  }

  const resolveDefaultBatch = (pattern: string): string => {
    return pattern
      .replace('{DATE}', new Date().toISOString().slice(0, 10).replace(/-/g, ''))
      .replace('{SEQ}', String(state.batches.length + 1).padStart(3, '0'))
  }

  const addTaskAuditLog = (taskId: string, taskName: string, action: TaskAuditAction, detail?: string) => {
    const user = getCurrentUser()
    const entry: TaskAuditLogEntry = {
      id: uuidv4(),
      taskId,
      taskName,
      action,
      operatorId: state.currentUserId || '',
      operatorName: user?.username || '未知',
      timestamp: new Date().toISOString(),
      detail,
    }
    dispatch({ type: 'ADD_TASK_AUDIT_LOG', payload: entry })
  }

  const canModifyTask = (task: ImportTask): boolean => {
    if (task.status === 'completed' || task.status === 'reverted') {
      const user = getCurrentUser()
      return user?.role === 'reviewer' || task.createdById === state.currentUserId
    }
    if (task.createdById !== state.currentUserId) {
      const user = getCurrentUser()
      return user?.role === 'reviewer'
    }
    return true
  }

  const createImportTask = (taskName: string, draftState: Partial<ImportTaskDraftState>): ImportTask => {
    const user = getCurrentUser()
    const scheme = draftState.selectedSchemeId
      ? state.importSchemes.find((s) => s.id === draftState.selectedSchemeId)
      : null
    const batch = draftState.selectedBatchId
      ? state.batches.find((b) => b.id === draftState.selectedBatchId)
      : null
    const task: ImportTask = {
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
    }
    dispatch({ type: 'ADD_IMPORT_TASK', payload: task })
    dispatch({ type: 'SET_LAST_ACTIVE_TASK', taskId: task.id })
    addTaskAuditLog(task.id, task.taskName, 'create', '创建导入任务')
    addOperationLog('task', '创建任务', `创建导入任务：${task.taskName}`, task.id, task.taskName)
    return task
  }

  const updateImportTaskDraft = (
    taskId: string,
    draftUpdates: Partial<ImportTaskDraftState>,
    statusUpdate?: ImportTaskStatus
  ): { success: boolean; error?: string; task?: ImportTask } => {
    const task = state.importTasks.find((t) => t.id === taskId)
    if (!task) return { success: false, error: '任务不存在' }
    if (!canModifyTask(task)) return { success: false, error: '无权修改此任务' }

    const scheme = draftUpdates.selectedSchemeId
      ? state.importSchemes.find((s) => s.id === draftUpdates.selectedSchemeId)
      : (task.schemeId ? state.importSchemes.find((s) => s.id === task.schemeId) : null)
    const batch = draftUpdates.selectedBatchId
      ? state.batches.find((b) => b.id === draftUpdates.selectedBatchId)
      : (task.batchId ? state.batches.find((b) => b.id === task.batchId) : null)

    const newStatus = statusUpdate || task.status

    const updated: ImportTask = {
      ...task,
      status: newStatus,
      batchId: draftUpdates.selectedBatchId !== undefined ? draftUpdates.selectedBatchId || null : task.batchId,
      batchNo: batch?.batchNo || task.batchNo,
      schemeId: draftUpdates.selectedSchemeId !== undefined ? draftUpdates.selectedSchemeId || null : task.schemeId,
      schemeName: scheme?.name || task.schemeName,
      draftState: {
        ...task.draftState,
        ...draftUpdates,
      },
      updatedAt: new Date().toISOString(),
    }
    dispatch({ type: 'UPDATE_IMPORT_TASK', payload: updated })
    if (statusUpdate === 'prevalidated') {
      addTaskAuditLog(taskId, updated.taskName, 'prevalidate', '完成数据预检')
    } else {
      addTaskAuditLog(taskId, updated.taskName, 'update_draft', '更新任务草稿')
    }
    return { success: true, task: updated }
  }

  const completeImportTask = (
    taskId: string,
    importResultId: string,
    importResultSnapshot: ImportResult
  ): { success: boolean; error?: string } => {
    const task = state.importTasks.find((t) => t.id === taskId)
    if (!task) return { success: false, error: '任务不存在' }
    const updated: ImportTask = {
      ...task,
      status: 'completed',
      importResultId,
      importResultSnapshot,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    dispatch({ type: 'UPDATE_IMPORT_TASK', payload: updated })
    addTaskAuditLog(taskId, updated.taskName, 'execute', `执行完成，成功${importResultSnapshot.successCount}条，失败${importResultSnapshot.failedCount}条`)
    addOperationLog('task', '执行任务', `任务「${task.taskName}」执行完成`, taskId, task.taskName)
    return { success: true }
  }

  const cancelImportTask = (taskId: string): { success: boolean; error?: string } => {
    const task = state.importTasks.find((t) => t.id === taskId)
    if (!task) return { success: false, error: '任务不存在' }
    if (!canModifyTask(task)) return { success: false, error: '无权取消此任务' }
    const updated: ImportTask = {
      ...task,
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    }
    dispatch({ type: 'UPDATE_IMPORT_TASK', payload: updated })
    addTaskAuditLog(taskId, updated.taskName, 'cancel', '取消任务')
    addOperationLog('task', '取消任务', `取消任务：${task.taskName}`, taskId, task.taskName)
    return { success: true }
  }

  const deleteImportTask = (taskId: string): { success: boolean; error?: string } => {
    const task = state.importTasks.find((t) => t.id === taskId)
    if (!task) return { success: false, error: '任务不存在' }
    if (!canModifyTask(task)) return { success: false, error: '无权删除此任务' }
    dispatch({ type: 'DELETE_IMPORT_TASK', taskId })
    addTaskAuditLog(taskId, task.taskName, 'delete', '删除任务')
    addOperationLog('task', '删除任务', `删除任务：${task.taskName}`, taskId, task.taskName)
    return { success: true }
  }

  const renameImportTask = (taskId: string, newName: string): { success: boolean; error?: string } => {
    const task = state.importTasks.find((t) => t.id === taskId)
    if (!task) return { success: false, error: '任务不存在' }
    if (!canModifyTask(task)) return { success: false, error: '无权重命名此任务' }
    const oldName = task.taskName
    const updated: ImportTask = { ...task, taskName: newName, updatedAt: new Date().toISOString() }
    dispatch({ type: 'UPDATE_IMPORT_TASK', payload: updated })
    addTaskAuditLog(taskId, newName, 'rename', `任务重命名：${oldName} → ${newName}`)
    return { success: true }
  }

  const buildImportValidationPipeline = (
    batchId: string,
    csvContent: string,
    schemeId: string | null
  ) => {
    const scheme = schemeId ? state.importSchemes.find((s) => s.id === schemeId) : null
    const columnMappings = scheme ? scheme.columnMappings : [
      { csvColumn: '样本编号', targetField: 'sampleNo' },
      { csvColumn: '数量', targetField: 'quantity' },
      { csvColumn: '来源', targetField: 'source' },
    ]
    const validationToggles = scheme ? scheme.validationToggles : { ...defaultValidationToggles }
    const parsedRows = scheme
      ? parseCSVWithScheme(csvContent, scheme.columnMappings)
      : parseCSV(csvContent)
    const prevalidateSummary = prevalidateImportCSV(batchId, parsedRows, validationToggles)
    return { parsedRows, validationToggles, columnMappings, prevalidateSummary }
  }

  const FIELD_LABELS: Record<SchemeMergeableFieldName, string> = {
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
  }

  const getFieldValue = (scheme: ImportScheme, fieldName: SchemeMergeableFieldName): unknown => {
    switch (fieldName) {
      case 'columnMappings': return scheme.columnMappings
      case 'defaultBatch.batchNoPattern': return scheme.defaultBatch.batchNoPattern
      case 'defaultBatch.batchNamePattern': return scheme.defaultBatch.batchNamePattern
      case 'validationToggles.skipEmptySampleNo': return scheme.validationToggles.skipEmptySampleNo
      case 'validationToggles.skipDuplicateInFile': return scheme.validationToggles.skipDuplicateInFile
      case 'validationToggles.skipDuplicateInBatch': return scheme.validationToggles.skipDuplicateInBatch
      case 'validationToggles.skipInvalidQuantity': return scheme.validationToggles.skipInvalidQuantity
      case 'validationToggles.skipEmptySource': return scheme.validationToggles.skipEmptySource
      case 'isShared': return scheme.isShared
      case 'isLocked': return scheme.isLocked
    }
  }

  const getDisplayValue = (fieldName: SchemeMergeableFieldName, value: unknown): string => {
    if (fieldName === 'columnMappings') {
      const mappings = value as ColumnMapping[]
      if (!Array.isArray(mappings)) return ''
      return mappings.map((m) => `${m.csvColumn}→${m.targetField}`).join('; ')
    }
    if (typeof value === 'boolean') return value ? '是' : '否'
    if (typeof value === 'string') return value
    return String(value ?? '')
  }

  const previewSchemeMerge = (jsonString: string): SchemeMergePreview => {
    const emptyPreview: SchemeMergePreview = {
      conflictItems: [],
      newSchemes: [],
      totalIncoming: 0,
      conflictCount: 0,
      newCount: 0,
      blockedCount: 0,
    }

    let importData: { version: number; exportedAt: string; exportedBy: string; schemes: ImportScheme[] }
    try {
      importData = JSON.parse(jsonString)
    } catch {
      return emptyPreview
    }
    if (!importData.schemes || !Array.isArray(importData.schemes)) {
      return emptyPreview
    }

    const conflictItems: SchemeMergeConflictItem[] = []
    const newSchemes: ImportScheme[] = []
    const allFieldNames: SchemeMergeableFieldName[] = [
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
    ]

    for (const incoming of importData.schemes) {
      const existing = state.importSchemes.find((s) => s.name === incoming.name)
      if (!existing) {
        newSchemes.push(incoming)
        continue
      }

      let canMerge = true
      let blockReason: string | undefined

      if (!canModifyScheme(existing)) {
        canMerge = false
        blockReason = '只读共享方案，无法合并'
      }

      if (canMerge) {
        const hasRequiredFields = incoming.columnMappings && incoming.defaultBatch && incoming.validationToggles
        if (!hasRequiredFields) {
          canMerge = false
          blockReason = '字段结构不兼容'
        }
      }

      const fieldDiffs: SchemeMergeFieldDiff[] = allFieldNames.map((fieldName) => {
        const originalValue = getFieldValue(existing, fieldName)
        const newValue = getFieldValue(incoming, fieldName)
        const isSame = JSON.stringify(originalValue) === JSON.stringify(newValue)
        return {
          fieldName,
          fieldLabel: FIELD_LABELS[fieldName],
          originalValue,
          newValue,
          originalDisplay: getDisplayValue(fieldName, originalValue),
          newDisplay: getDisplayValue(fieldName, newValue),
          isSame,
          resolution: isSame ? 'keep_original' as MergeFieldResolution : 'conflict' as MergeFieldResolution,
        }
      })

      const hasUnresolvedConflicts = canMerge && fieldDiffs.some((d) => !d.isSame && d.resolution === 'conflict')

      conflictItems.push({
        incomingScheme: incoming,
        existingScheme: existing,
        canMerge,
        blockReason,
        fieldDiffs,
        hasUnresolvedConflicts,
      })
    }

    const blockedCount = conflictItems.filter((c) => !c.canMerge).length

    return {
      conflictItems,
      newSchemes,
      totalIncoming: importData.schemes.length,
      conflictCount: conflictItems.length,
      newCount: newSchemes.length,
      blockedCount,
    }
  }

  const setFieldValue = (scheme: ImportScheme, fieldName: SchemeMergeableFieldName, value: unknown): ImportScheme => {
    switch (fieldName) {
      case 'columnMappings': return { ...scheme, columnMappings: value as ColumnMapping[] }
      case 'defaultBatch.batchNoPattern': return { ...scheme, defaultBatch: { ...scheme.defaultBatch, batchNoPattern: value as string } }
      case 'defaultBatch.batchNamePattern': return { ...scheme, defaultBatch: { ...scheme.defaultBatch, batchNamePattern: value as string } }
      case 'validationToggles.skipEmptySampleNo': return { ...scheme, validationToggles: { ...scheme.validationToggles, skipEmptySampleNo: value as boolean } }
      case 'validationToggles.skipDuplicateInFile': return { ...scheme, validationToggles: { ...scheme.validationToggles, skipDuplicateInFile: value as boolean } }
      case 'validationToggles.skipDuplicateInBatch': return { ...scheme, validationToggles: { ...scheme.validationToggles, skipDuplicateInBatch: value as boolean } }
      case 'validationToggles.skipInvalidQuantity': return { ...scheme, validationToggles: { ...scheme.validationToggles, skipInvalidQuantity: value as boolean } }
      case 'validationToggles.skipEmptySource': return { ...scheme, validationToggles: { ...scheme.validationToggles, skipEmptySource: value as boolean } }
      case 'isShared': return { ...scheme, isShared: value as boolean }
      case 'isLocked': return { ...scheme, isLocked: value as boolean }
    }
  }

  const mergeImportSchemes = (
    preview: SchemeMergePreview,
    conflictResolutions: Record<string, Record<SchemeMergeableFieldName, MergeFieldResolution>>
  ): {
    success: boolean
    error?: string
    mergedCount: number
    newCount: number
    blockedCount: number
    mergeId: string
  } => {
    for (const item of preview.conflictItems) {
      if (!item.canMerge) continue
      const schemeResolutions = conflictResolutions[item.existingScheme.id]
      if (!schemeResolutions) {
        return { success: false, error: '存在未解决的冲突，无法确认导入', mergedCount: 0, newCount: 0, blockedCount: 0, mergeId: '' }
      }
      const hasUnresolved = item.fieldDiffs.some(
        (d) => !d.isSame && (!schemeResolutions[d.fieldName] || schemeResolutions[d.fieldName] === 'conflict')
      )
      if (hasUnresolved) {
        return { success: false, error: '存在未解决的冲突，无法确认导入', mergedCount: 0, newCount: 0, blockedCount: 0, mergeId: '' }
      }
    }

    const mergeId = uuidv4()
    const user = getCurrentUser()
    let mergedCount = 0
    let newCount = 0
    const addedSchemeIds: string[] = []

    dispatch({
      type: 'ADD_SCHEME_MERGE_SNAPSHOT',
      payload: {
        mergeId,
        originalSchemes: [...state.importSchemes],
        addedSchemeIds: [],
        operatorId: state.currentUserId || '',
        operatorName: user?.username || '未知',
        createdAt: new Date().toISOString(),
      },
    })

    for (const newSchemeData of preview.newSchemes) {
      const newScheme: ImportScheme = {
        ...newSchemeData,
        id: uuidv4(),
        createdBy: user?.username || '未知',
        createdById: state.currentUserId || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isShared: false,
        isLocked: false,
      }
      dispatch({ type: 'ADD_IMPORT_SCHEME', payload: newScheme })
      addedSchemeIds.push(newScheme.id)
      addSchemeAuditLog(newScheme.id, newScheme.name, 'merge', `合并导入新增方案「${newScheme.name}」`)
      emitSchemeChange('import', newScheme.id, newScheme.name, { detail: `合并导入新增方案「${newScheme.name}」` })
      dispatch({
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
      })
      newCount++
    }

    for (const item of preview.conflictItems) {
      if (!item.canMerge) {
        dispatch({
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
        })
        continue
      }

      const schemeResolutions = conflictResolutions[item.existingScheme.id]
      let mergedScheme = { ...item.existingScheme }
      const fieldSources: SchemeMergeFieldSource[] = []

      for (const diff of item.fieldDiffs) {
        const resolution = schemeResolutions[diff.fieldName] || 'keep_original'
        if (resolution === 'use_new') {
          mergedScheme = setFieldValue(mergedScheme, diff.fieldName, diff.newValue)
          fieldSources.push({
            fieldName: diff.fieldName,
            fieldLabel: FIELD_LABELS[diff.fieldName],
            source: 'new',
            originalValue: diff.originalValue,
            newValue: diff.newValue,
          })
        } else {
          fieldSources.push({
            fieldName: diff.fieldName,
            fieldLabel: FIELD_LABELS[diff.fieldName],
            source: 'original',
            originalValue: diff.originalValue,
            newValue: diff.newValue,
          })
        }
      }

      mergedScheme = { ...mergedScheme, updatedAt: new Date().toISOString() }
      dispatch({ type: 'UPDATE_IMPORT_SCHEME', payload: mergedScheme })
      addSchemeAuditLog(item.existingScheme.id, mergedScheme.name, 'merge', `合并导入方案「${mergedScheme.name}」`)
      emitSchemeChange('merge', item.existingScheme.id, mergedScheme.name, { detail: `合并导入方案「${mergedScheme.name}」` })

      dispatch({
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
      })
      mergedCount++
    }

    const blockedCount = preview.conflictItems.filter((c) => !c.canMerge).length

    addOperationLog('merge', '合并方案', `合并完成：新增${newCount}，合并${mergedCount}，阻止${blockedCount}`, mergeId)
    dispatch({ type: 'SET_LAST_SCHEME_MERGE_ID', mergeId })

    return { success: true, mergedCount, newCount, blockedCount, mergeId }
  }

  const canUndoLastSchemeMerge = (): boolean => {
    if (!state.lastSchemeMergeId) return false
    return state.schemeMergeSnapshots.some((s) => s.mergeId === state.lastSchemeMergeId)
  }

  const undoLastSchemeMerge = (): { success: boolean; error?: string } => {
    if (!canUndoLastSchemeMerge()) {
      return { success: false, error: '无可撤销的合并记录' }
    }

    const snapshot = state.schemeMergeSnapshots.find((s) => s.mergeId === state.lastSchemeMergeId)
    if (!snapshot) return { success: false, error: '合并快照不存在' }

    dispatch({
      type: 'RESTORE_SCHEME_MERGE',
      payload: { originalSchemes: snapshot.originalSchemes, addedSchemeIds: snapshot.addedSchemeIds },
    })

    const user = getCurrentUser()
    const logEntries = state.schemeMergeLogs.filter((l) => l.mergeId === snapshot.mergeId)
    for (const entry of logEntries) {
      dispatch({
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
      })

      if (entry.action === 'merge') {
        addSchemeAuditLog(entry.schemeId, entry.schemeName, 'merge_undo', `撤销合并方案「${entry.schemeName}」`)
        emitSchemeChange('merge_undo', entry.schemeId, entry.schemeName, { detail: `撤销合并方案「${entry.schemeName}」` })
      }
    }

    addOperationLog('merge', '撤销合并', `撤销合并操作：${snapshot.mergeId}`, snapshot.mergeId)

    return { success: true }
  }

  const getSchemeMergeLog = (schemeId: string): SchemeMergeLogEntry[] => {
    return state.schemeMergeLogs.filter((l) => l.schemeId === schemeId)
  }

  const getTaskAuditLog = (taskId: string): TaskAuditLogEntry[] => {
    return state.taskAuditLog.filter((l) => l.taskId === taskId)
  }

  const setLastActiveTask = (taskId: string | null) => {
    dispatch({ type: 'SET_LAST_ACTIVE_TASK', taskId })
  }

  const canRevertLastImport = (): boolean => {
    if (!state.lastImportId) return false
    const snapshot = state.rollbackSnapshots.find((s) => s.importResultId === state.lastImportId)
    if (!snapshot) return false
    const result = state.importResults.find((r) => r.id === state.lastImportId)
    if (!result || result.id === '__reverted__') return false
    const user = getCurrentUser()
    if (user?.role !== 'reviewer' && snapshot.createdById !== state.currentUserId) {
      return false
    }
    return true
  }

  const getLastImportSnapshot = (): ImportRollbackSnapshot | null => {
    if (!state.lastImportId) return null
    return state.rollbackSnapshots.find((s) => s.importResultId === state.lastImportId) || null
  }

  const revertLastImport = (reason?: string): { success: boolean; error?: string; revertedCount?: number } => {
    if (!canRevertLastImport()) {
      return { success: false, error: '无可撤销的导入记录，或无权限撤销' }
    }
    const importResultId = state.lastImportId!
    const snapshot = state.rollbackSnapshots.find((s) => s.importResultId === importResultId)
    if (!snapshot) return { success: false, error: '撤销快照不存在' }

    const result = state.importResults.find((r) => r.id === importResultId)
    if (!result) return { success: false, error: '导入记录不存在' }

    dispatch({ type: 'REMOVE_SAMPLES_BATCH', sampleIds: snapshot.removedSampleIds, ledgerIds: snapshot.removedBatchLedgerIds })

    const user = getCurrentUser()
    const updatedResult: ImportResult = {
      ...result,
      id: result.id,
      details: result.details.map((d) => ({ ...d })),
    }
    ;(updatedResult as any)._reverted = true
    ;(updatedResult as any)._revertedAt = new Date().toISOString()
    ;(updatedResult as any)._revertedBy = user?.username
    ;(updatedResult as any)._revertedReason = reason || '未说明'
    dispatch({ type: 'UPDATE_IMPORT_RESULT', payload: updatedResult })

    if (snapshot.taskId) {
      const task = state.importTasks.find((t) => t.id === snapshot.taskId)
      if (task) {
        const updatedTask: ImportTask = {
          ...task,
          status: 'reverted',
          revertedAt: new Date().toISOString(),
          revertedBy: user?.username,
          revertedReason: reason || '未说明',
          updatedAt: new Date().toISOString(),
        }
        dispatch({ type: 'UPDATE_IMPORT_TASK', payload: updatedTask })
        addTaskAuditLog(task.id, task.taskName, 'revert', `撤销导入${reason ? '：' + reason : ''}`)
      }
    }

    dispatch({ type: 'SET_LAST_IMPORT_ID', importId: null })

    addOperationLog(
      'import',
      '撤销导入',
      `撤销导入记录，回滚${snapshot.removedSampleIds.length}条样本${reason ? '，原因：' + reason : ''}`,
      importResultId
    )

    return { success: true, revertedCount: snapshot.removedSampleIds.length }
  }

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
        getCurrentUser,
        createBatch,
        addSample,
        checkDuplicateSampleNo,
        changeSampleStatus,
        undoLastStatus,
        canReview,
        canModifySample,
        exportHandoverCSV,
        doExportCSV,
        isElectron,
        parseCSV,
        parseCSVWithScheme,
        prevalidateImportCSV,
        batchImportSamples,
        exportBatchLedgerCSV,
        getBatchLedgerSummary,
        canModifyScheme,
        createImportScheme,
        renameImportScheme,
        copyImportScheme,
        deleteImportScheme,
        modifyImportScheme,
        lockScheme,
        unlockScheme,
        exportSchemesJSON,
        importSchemesJSON,
        setLastSelectedScheme,
        getSchemeAuditLog,
        doExportJSON,
        resolveDefaultBatch,
        clearLastSchemeChange,
        isLastSelectedSchemeValid,
        addOperationLog,
        createImportTask,
        updateImportTaskDraft,
        completeImportTask,
        cancelImportTask,
        deleteImportTask,
        renameImportTask,
        revertLastImport,
        canRevertLastImport,
        getLastImportSnapshot,
        getTaskAuditLog,
        addTaskAuditLog,
        canModifyTask,
        setLastActiveTask,
        buildImportValidationPipeline,
        previewSchemeMerge,
        mergeImportSchemes,
        undoLastSchemeMerge,
        canUndoLastSchemeMerge,
        getSchemeMergeLog,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
