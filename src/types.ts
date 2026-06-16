export type UserRole = 'operator' | 'reviewer'

export interface User {
  id: string
  username: string
  role: UserRole
}

export type SampleStatus = 'received' | 'aliquoted' | 'reviewing' | 'reviewed' | 'returned'

export const STATUS_LABELS: Record<SampleStatus, string> = {
  received: '已接收',
  aliquoted: '已分装',
  reviewing: '待复核',
  reviewed: '已复核通过',
  returned: '已退回',
}

export const STATUS_COLORS: Record<SampleStatus, string> = {
  received: '#1890ff',
  aliquoted: '#52c41a',
  reviewing: '#faad14',
  reviewed: '#722ed1',
  returned: '#f5222d',
}

export interface HistoryRecord {
  id: string
  sampleId: string
  action: string
  operatorId: string
  operatorName: string
  timestamp: string
  reason?: string
  remark?: string
  fromStatus: string
  toStatus: string
}

export interface Sample {
  id: string
  batchId: string
  sampleNo: string
  quantity: number
  source: string
  status: SampleStatus
  receivedAt: string
  receivedBy: string
  handoverBy?: string
  handoverAt?: string
  history: HistoryRecord[]
}

export interface Batch {
  id: string
  batchNo: string
  name: string
  createdAt: string
  createdBy: string
}

export interface ImportResultDetail {
  rowIndex: number
  sampleNo: string
  success: boolean
  error?: string
}

export interface ImportResult {
  id: string
  batchId: string
  timestamp: string
  operatorId: string
  operatorName: string
  totalCount: number
  successCount: number
  failedCount: number
  details: ImportResultDetail[]
  schemeId?: string
  schemeName?: string
  validationToggles?: ValidationToggles
  columnMappings?: ColumnMapping[]
}

export interface BatchLedgerEntry {
  id: string
  batchId: string
  sampleId: string
  sampleNo: string
  action: string
  operatorId: string
  operatorName: string
  timestamp: string
  fromStatus: string
  toStatus: string
  reason?: string
  remark?: string
}

export interface PrevalidateResult {
  rowIndex: number
  sampleNo: string
  valid: boolean
  errors: string[]
  warnings: string[]
  quantity?: string
  source?: string
}

export interface PrevalidateSummary {
  total: number
  validCount: number
  invalidCount: number
  canImport: boolean
  results: PrevalidateResult[]
}

export interface ColumnMapping {
  csvColumn: string
  targetField: string
}

export interface ValidationToggles {
  skipEmptySampleNo: boolean
  skipDuplicateInFile: boolean
  skipDuplicateInBatch: boolean
  skipInvalidQuantity: boolean
  skipEmptySource: boolean
}

export interface DefaultBatchInfo {
  batchNoPattern: string
  batchNamePattern: string
}

export interface ImportScheme {
  id: string
  name: string
  columnMappings: ColumnMapping[]
  defaultBatch: DefaultBatchInfo
  validationToggles: ValidationToggles
  isShared: boolean
  isLocked: boolean
  createdBy: string
  createdById: string
  createdAt: string
  updatedAt: string
}

export type SchemeAuditAction = 'create' | 'rename' | 'copy' | 'delete' | 'modify' | 'import' | 'export' | 'lock' | 'unlock' | 'merge' | 'merge_undo'

export interface SchemeAuditLogEntry {
  id: string
  schemeId: string
  schemeName: string
  action: SchemeAuditAction
  operatorId: string
  operatorName: string
  timestamp: string
  detail?: string
}

export type ConflictResolution = 'overwrite' | 'skip' | 'merge'

export type MergeFieldResolution = 'keep_original' | 'use_new' | 'conflict'

export type SchemeMergeableFieldName =
  | 'columnMappings'
  | 'defaultBatch.batchNoPattern'
  | 'defaultBatch.batchNamePattern'
  | 'validationToggles.skipEmptySampleNo'
  | 'validationToggles.skipDuplicateInFile'
  | 'validationToggles.skipDuplicateInBatch'
  | 'validationToggles.skipInvalidQuantity'
  | 'validationToggles.skipEmptySource'
  | 'isShared'
  | 'isLocked'

export interface SchemeMergeFieldDiff {
  fieldName: SchemeMergeableFieldName
  fieldLabel: string
  originalValue: unknown
  newValue: unknown
  originalDisplay: string
  newDisplay: string
  isSame: boolean
  resolution: MergeFieldResolution
}

export interface SchemeMergeConflictItem {
  incomingScheme: ImportScheme
  existingScheme: ImportScheme
  canMerge: boolean
  blockReason?: string
  fieldDiffs: SchemeMergeFieldDiff[]
  hasUnresolvedConflicts: boolean
}

export interface SchemeMergePreview {
  conflictItems: SchemeMergeConflictItem[]
  newSchemes: ImportScheme[]
  totalIncoming: number
  conflictCount: number
  newCount: number
  blockedCount: number
}

export interface SchemeMergeFieldSource {
  fieldName: SchemeMergeableFieldName
  fieldLabel: string
  source: 'original' | 'new'
  originalValue: unknown
  newValue: unknown
}

export interface SchemeMergeLogEntry {
  id: string
  mergeId: string
  schemeId: string
  schemeName: string
  action: 'merge' | 'merge_new' | 'merge_blocked' | 'merge_undo'
  operatorId: string
  operatorName: string
  timestamp: string
  fieldSources: SchemeMergeFieldSource[]
  blockReason?: string
  detail?: string
}

export interface SchemeMergeSnapshot {
  mergeId: string
  originalSchemes: ImportScheme[]
  addedSchemeIds: string[]
  operatorId: string
  operatorName: string
  createdAt: string
}

export type SchemeChangeType = 'create' | 'update' | 'delete' | 'rename' | 'overwrite' | 'import' | 'lock' | 'unlock' | 'merge' | 'merge_undo'

export interface SchemeChangeEvent {
  type: SchemeChangeType
  schemeId: string
  schemeName: string
  oldName?: string
  timestamp: string
  detail?: string
  affectedLastSelected?: boolean
}

export type OperationLogCategory = 'batch' | 'import' | 'scheme' | 'task' | 'merge'

export interface OperationLogEntry {
  id: string
  category: OperationLogCategory
  action: string
  operatorId: string
  operatorName: string
  timestamp: string
  detail?: string
  targetId?: string
  targetName?: string
}

export type ImportTaskStatus = 'draft' | 'prevalidated' | 'importing' | 'completed' | 'cancelled' | 'reverted'

export interface ImportTaskDraftState {
  csvContent: string | null
  fileName: string | null
  selectedBatchId: string | null
  selectedSchemeId: string | null
  columnMappings: ColumnMapping[] | null
  validationToggles: ValidationToggles | null
  prevalidateSummary: PrevalidateSummary | null
  parsedRows: { sampleNo: string; quantity: string; source: string }[] | null
  uiScrollPosition?: number
}

export interface ImportTask {
  id: string
  taskName: string
  status: ImportTaskStatus
  batchId: string | null
  batchNo?: string
  schemeId: string | null
  schemeName?: string
  draftState: ImportTaskDraftState
  importResultId: string | null
  importResultSnapshot?: ImportResult
  revertedAt?: string
  revertedBy?: string
  revertedReason?: string
  createdBy: string
  createdById: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type TaskAuditAction = 'create' | 'update_draft' | 'resume' | 'prevalidate' | 'execute' | 'cancel' | 'revert' | 'delete' | 'rename'

export interface TaskAuditLogEntry {
  id: string
  taskId: string
  taskName: string
  action: TaskAuditAction
  operatorId: string
  operatorName: string
  timestamp: string
  detail?: string
}

export interface ImportRollbackSnapshot {
  importResultId: string
  taskId: string | null
  removedSampleIds: string[]
  removedBatchLedgerIds: string[]
  removedSampleHistories: HistoryRecord[]
  createdAt: string
  createdBy: string
  createdById: string
}

export interface AppData {
  users: User[]
  batches: Batch[]
  samples: Sample[]
  importResults: ImportResult[]
  batchLedger: BatchLedgerEntry[]
  currentUserId: string | null
  importSchemes: ImportScheme[]
  schemeAuditLog: SchemeAuditLogEntry[]
  lastSelectedSchemeId: string | null
  lastSchemeChange: SchemeChangeEvent | null
  operationLog: OperationLogEntry[]
  importTasks: ImportTask[]
  taskAuditLog: TaskAuditLogEntry[]
  lastActiveTaskId: string | null
  rollbackSnapshots: ImportRollbackSnapshot[]
  lastImportId: string | null
  schemeMergeLogs: SchemeMergeLogEntry[]
  lastSchemeMergeId: string | null
  schemeMergeSnapshots: SchemeMergeSnapshot[]
}
