import React, { createContext, useContext, useReducer, useEffect, ReactNode, useState, useRef } from 'react'
import { AppData, Sample, Batch, HistoryRecord, SampleStatus, User, ImportResult, BatchLedgerEntry, PrevalidateSummary, PrevalidateResult, ImportScheme, SchemeAuditLogEntry, SchemeAuditAction, ConflictResolution, ColumnMapping, ValidationToggles, DefaultBatchInfo } from '../types'
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
      }
    case 'ADD_SCHEME_AUDIT_LOG':
      return {
        ...state,
        schemeAuditLog: [...state.schemeAuditLog, action.payload],
      }
    case 'SET_LAST_SELECTED_SCHEME':
      return { ...state, lastSelectedSchemeId: action.schemeId }
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
  batchImportSamples: (batchId: string, validatedRows: PrevalidateResult[]) => {
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
    return {
      ...defaultData,
      ...data,
      importResults: data.importResults || [],
      batchLedger: data.batchLedger || [],
      importSchemes: data.importSchemes || [],
      schemeAuditLog: data.schemeAuditLog || [],
      lastSelectedSchemeId: data.lastSelectedSchemeId || null,
      samples: (data.samples || []).map((s) => ({
        ...s,
        history: s.history || [],
      })),
    }
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
    return batch
  }

  const checkDuplicateSampleNo = (sampleNo: string, batchId: string, excludeId?: string): boolean => {
    return state.samples.some(
      (s) => s.batchId === batchId && s.sampleNo === sampleNo && s.id !== excludeId
    )
  }

  const addSample = (sampleData: Omit<Sample, 'id' | 'history'>): { success: boolean; error?: string; sample?: Sample } => {
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

    return { success: true, sample }
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
    validatedRows: PrevalidateResult[]
  ): {
    success: boolean
    error?: string
    importResult?: ImportResult
    importedSampleIds?: string[]
  } => {
    const validRows = validatedRows.filter((r) => r.valid)
    const invalidRows = validatedRows.filter((r) => !r.valid)
    const importId = uuidv4()
    const importedSampleIds: string[] = []

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

    for (const row of validRows) {
      try {
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
    return { success: true, copiedScheme: copied }
  }

  const deleteImportScheme = (schemeId: string): { success: boolean; error?: string } => {
    const scheme = state.importSchemes.find((s) => s.id === schemeId)
    if (!scheme) return { success: false, error: '方案不存在' }
    if (!canModifyScheme(scheme)) return { success: false, error: '无权删除此方案（他人锁定共享方案）' }
    dispatch({ type: 'DELETE_IMPORT_SCHEME', schemeId })
    addSchemeAuditLog(schemeId, scheme.name, 'delete', `删除方案「${scheme.name}」`)
    return { success: true }
  }

  const modifyImportScheme = (schemeId: string, updates: Partial<ImportScheme>): { success: boolean; error?: string } => {
    const scheme = state.importSchemes.find((s) => s.id === schemeId)
    if (!scheme) return { success: false, error: '方案不存在' }
    if (!canModifyScheme(scheme)) return { success: false, error: '无权修改此方案（他人锁定共享方案）' }
    const updated: ImportScheme = { ...scheme, ...updates, updatedAt: new Date().toISOString() }
    dispatch({ type: 'UPDATE_IMPORT_SCHEME', payload: updated })
    addSchemeAuditLog(schemeId, updated.name, 'modify', '修改方案配置')
    return { success: true }
  }

  const lockScheme = (schemeId: string): { success: boolean; error?: string } => {
    const scheme = state.importSchemes.find((s) => s.id === schemeId)
    if (!scheme) return { success: false, error: '方案不存在' }
    if (scheme.createdById !== state.currentUserId) return { success: false, error: '只有方案创建者才能锁定' }
    const updated: ImportScheme = { ...scheme, isLocked: true, isShared: true, updatedAt: new Date().toISOString() }
    dispatch({ type: 'UPDATE_IMPORT_SCHEME', payload: updated })
    addSchemeAuditLog(schemeId, scheme.name, 'lock', '锁定共享方案')
    return { success: true }
  }

  const unlockScheme = (schemeId: string): { success: boolean; error?: string } => {
    const scheme = state.importSchemes.find((s) => s.id === schemeId)
    if (!scheme) return { success: false, error: '方案不存在' }
    if (scheme.createdById !== state.currentUserId) return { success: false, error: '只有方案创建者才能解锁' }
    const updated: ImportScheme = { ...scheme, isLocked: false, updatedAt: new Date().toISOString() }
    dispatch({ type: 'UPDATE_IMPORT_SCHEME', payload: updated })
    addSchemeAuditLog(schemeId, scheme.name, 'unlock', '解锁方案')
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
    }

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
