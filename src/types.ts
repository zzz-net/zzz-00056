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

export type SchemeAuditAction = 'create' | 'rename' | 'copy' | 'delete' | 'modify' | 'import' | 'export' | 'lock' | 'unlock'

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

export type ConflictResolution = 'overwrite' | 'skip'

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
}
