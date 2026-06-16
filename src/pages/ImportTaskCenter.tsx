import { useState, useMemo } from 'react'
import { useApp } from '../store/AppContext'
import { ImportTask, ImportTaskStatus } from '../types'

const STATUS_LABELS: Record<ImportTaskStatus, string> = {
  draft: '草稿',
  prevalidated: '已预检',
  importing: '导入中',
  completed: '已完成',
  cancelled: '已取消',
  reverted: '已撤销',
}

const STATUS_COLORS: Record<ImportTaskStatus, string> = {
  draft: '#909399',
  prevalidated: '#409eff',
  importing: '#e6a23c',
  completed: '#67c23a',
  cancelled: '#909399',
  reverted: '#f56c6c',
}

type FilterStatus = 'all' | ImportTaskStatus

function ImportTaskCenter() {
  const {
    state,
    createImportTask,
    updateImportTaskDraft,
    cancelImportTask,
    deleteImportTask,
    renameImportTask,
    canModifyTask,
    canRevertLastImport,
    revertLastImport,
    getLastImportSnapshot,
    getTaskAuditLog,
    setLastActiveTask,
    getCurrentUser,
    addTaskAuditLog,
  } = useApp()

  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterBatchId, setFilterBatchId] = useState<string>('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [showNewTaskModal, setShowNewTaskModal] = useState(false)
  const [newTaskName, setNewTaskName] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showAuditModal, setShowAuditModal] = useState(false)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [renameInput, setRenameInput] = useState('')
  const [showRevertModal, setShowRevertModal] = useState(false)
  const [revertReason, setRevertReason] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const filteredTasks = useMemo(() => {
    let result = [...state.importTasks]
    if (filterStatus !== 'all') {
      result = result.filter((t) => t.status === filterStatus)
    }
    if (filterBatchId) {
      result = result.filter((t) => t.batchId === filterBatchId)
    }
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase()
      result = result.filter(
        (t) =>
          t.taskName.toLowerCase().includes(kw) ||
          (t.batchNo || '').toLowerCase().includes(kw) ||
          (t.schemeName || '').toLowerCase().includes(kw)
      )
    }
    return result.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }, [state.importTasks, filterStatus, filterBatchId, searchKeyword])

  const stats = useMemo(() => {
    const total = state.importTasks.length
    const draft = state.importTasks.filter((t) => t.status === 'draft').length
    const completed = state.importTasks.filter((t) => t.status === 'completed').length
    const reverted = state.importTasks.filter((t) => t.status === 'reverted').length
    return { total, draft, completed, reverted }
  }, [state.importTasks])

  const user = getCurrentUser()
  const lastSnapshot = getLastImportSnapshot()
  const lastImportResult = state.lastImportId
    ? state.importResults.find((r) => r.id === state.lastImportId)
    : null
  const selectedTask = selectedTaskId
    ? state.importTasks.find((t) => t.id === selectedTaskId)
    : null
  const auditLogs = selectedTaskId ? getTaskAuditLog(selectedTaskId) : []

  const handleCreateTask = () => {
    if (!newTaskName.trim()) {
      setErrorMsg('请输入任务名称')
      return
    }
    const task = createImportTask(newTaskName.trim(), {})
    setLastActiveTask(task.id)
    setSuccessMsg(`任务「${task.taskName}」创建成功`)
    setShowNewTaskModal(false)
    setNewTaskName('')
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const handleResumeTask = (task: ImportTask) => {
    setLastActiveTask(task.id)
    addTaskAuditLog(task.id, task.taskName, 'resume', '从任务中心恢复任务到导入流程')
    setSuccessMsg(`已载入任务「${task.taskName}」，请在「样本接收」页面点击「CSV 批量导入」继续`)
    setTimeout(() => setSuccessMsg(''), 5000)
  }

  const handleRenameTask = () => {
    if (!selectedTaskId || !renameInput.trim()) return
    const result = renameImportTask(selectedTaskId, renameInput.trim())
    if (result.success) {
      setSuccessMsg('重命名成功')
      setShowRenameModal(false)
      setRenameInput('')
      setTimeout(() => setSuccessMsg(''), 3000)
    } else {
      setErrorMsg(result.error || '重命名失败')
    }
  }

  const handleCancelTask = (task: ImportTask) => {
    if (!confirm(`确定要取消任务「${task.taskName}」吗？`)) return
    const result = cancelImportTask(task.id)
    if (result.success) {
      setSuccessMsg('任务已取消')
      setTimeout(() => setSuccessMsg(''), 3000)
    } else {
      setErrorMsg(result.error || '取消失败')
    }
  }

  const handleDeleteTask = (task: ImportTask) => {
    if (!confirm(`确定要删除任务「${task.taskName}」吗？此操作不可恢复。`)) return
    const result = deleteImportTask(task.id)
    if (result.success) {
      if (selectedTaskId === task.id) {
        setSelectedTaskId(null)
        setShowDetailModal(false)
        setShowAuditModal(false)
      }
      setSuccessMsg('任务已删除')
      setTimeout(() => setSuccessMsg(''), 3000)
    } else {
      setErrorMsg(result.error || '删除失败')
    }
  }

  const handleRevertImport = () => {
    if (!canRevertLastImport()) {
      setErrorMsg('无法撤销')
      return
    }
    const result = revertLastImport(revertReason.trim() || undefined)
    if (result.success) {
      setSuccessMsg(`撤销成功！已回滚 ${result.revertedCount} 条样本`)
      setShowRevertModal(false)
      setRevertReason('')
      setTimeout(() => setSuccessMsg(''), 5000)
    } else {
      setErrorMsg(result.error || '撤销失败')
    }
  }

  const openRenameModal = (task: ImportTask) => {
    setSelectedTaskId(task.id)
    setRenameInput(task.taskName)
    setShowRenameModal(true)
  }

  const openDetailModal = (task: ImportTask) => {
    setSelectedTaskId(task.id)
    setShowDetailModal(true)
  }

  const openAuditModal = (task: ImportTask) => {
    setSelectedTaskId(task.id)
    setShowAuditModal(true)
  }

  const renderDraftBadge = (task: ImportTask) => {
    const hasCSV = !!task.draftState.csvContent
    const hasPrevalidate = !!task.draftState.prevalidateSummary
    const hasBatch = !!task.batchId
    return (
      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
        {hasBatch ? (
          <span style={{ padding: '1px 6px', fontSize: 11, borderRadius: 3, background: '#e1f3d8', color: '#52c41a' }}>
            ✓ 已选批次
          </span>
        ) : (
          <span style={{ padding: '1px 6px', fontSize: 11, borderRadius: 3, background: '#fef0f0', color: '#f56c6c' }}>
            ! 未选批次
          </span>
        )}
        {hasCSV ? (
          <span style={{ padding: '1px 6px', fontSize: 11, borderRadius: 3, background: '#e1f3d8', color: '#52c41a' }}>
            ✓ CSV已选
          </span>
        ) : (
          <span style={{ padding: '1px 6px', fontSize: 11, borderRadius: 3, background: '#fef0f0', color: '#f56c6c' }}>
            ! 未选CSV
          </span>
        )}
        {hasPrevalidate ? (
          <span style={{ padding: '1px 6px', fontSize: 11, borderRadius: 3, background: '#e1f3d8', color: '#52c41a' }}>
            ✓ 已预检
          </span>
        ) : (
          <span style={{ padding: '1px 6px', fontSize: 11, borderRadius: 3, background: '#fdf6ec', color: '#e6a23c' }}>
            - 未预检
          </span>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">导入任务中心</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {canRevertLastImport() && (
            <button
              className="btn btn-warning"
              onClick={() => setShowRevertModal(true)}
              title="撤销最近一次批量导入"
            >
              ↩️ 撤销最近导入
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => setShowNewTaskModal(true)}
          >
            + 新建任务
          </button>
        </div>
      </div>

      {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {canRevertLastImport() && lastImportResult && (
        <div style={{
          padding: '14px 16px',
          background: '#fff7e6',
          border: '1px solid #ffd591',
          borderRadius: 6,
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#d46b08', marginBottom: 4 }}>
              ⚠️ 最近一次导入可撤销
            </div>
            <div style={{ fontSize: 13, color: '#666' }}>
              批次：<strong>{state.batches.find((b) => b.id === lastImportResult.batchId)?.batchNo || '-'}</strong>
              &nbsp;&nbsp;操作时间：<strong>{new Date(lastImportResult.timestamp).toLocaleString('zh-CN')}</strong>
              &nbsp;&nbsp;成功：<strong style={{ color: '#52c41a' }}>{lastImportResult.successCount}条</strong>
              &nbsp;&nbsp;失败：<strong style={{ color: '#f56c6c' }}>{lastImportResult.failedCount}条</strong>
              &nbsp;&nbsp;操作人：<strong>{lastImportResult.operatorName}</strong>
              {lastSnapshot?.taskId && (
                <>
                  &nbsp;&nbsp;关联任务：<strong>{state.importTasks.find((t) => t.id === lastSnapshot.taskId)?.taskName || '-'}</strong>
                </>
              )}
            </div>
          </div>
          <button className="btn btn-warning btn-sm" onClick={() => setShowRevertModal(true)}>
            ↩️ 立即撤销
          </button>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        marginBottom: 16,
      }}>
        <div style={{ padding: 16, background: '#fff', borderRadius: 6, border: '1px solid #e8e8e8' }}>
          <div style={{ fontSize: 12, color: '#909399', marginBottom: 6 }}>任务总数</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#303133' }}>{stats.total}</div>
        </div>
        <div style={{ padding: 16, background: '#fff', borderRadius: 6, border: '1px solid #e8e8e8' }}>
          <div style={{ fontSize: 12, color: '#909399', marginBottom: 6 }}>草稿中</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: STATUS_COLORS.draft }}>{stats.draft}</div>
        </div>
        <div style={{ padding: 16, background: '#fff', borderRadius: 6, border: '1px solid #e8e8e8' }}>
          <div style={{ fontSize: 12, color: '#909399', marginBottom: 6 }}>已完成</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: STATUS_COLORS.completed }}>{stats.completed}</div>
        </div>
        <div style={{ padding: 16, background: '#fff', borderRadius: 6, border: '1px solid #e8e8e8' }}>
          <div style={{ fontSize: 12, color: '#909399', marginBottom: 6 }}>已撤销</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: STATUS_COLORS.reverted }}>{stats.reverted}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, alignItems: 'center' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">搜索</label>
            <input
              type="text"
              className="form-input"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索任务名 / 批次号 / 方案名"
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">状态筛选</label>
            <select
              className="form-input"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            >
              <option value="all">全部状态</option>
              <option value="draft">草稿</option>
              <option value="prevalidated">已预检</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
              <option value="reverted">已撤销</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">批次筛选</label>
            <select
              className="form-input"
              value={filterBatchId}
              onChange={(e) => setFilterBatchId(e.target.value)}
            >
              <option value="">全部批次</option>
              {state.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} - {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {filteredTasks.length === 0 ? (
        <div style={{
          padding: 80,
          textAlign: 'center',
          color: '#909399',
          background: '#fff',
          borderRadius: 6,
          border: '1px solid #e8e8e8',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 16, marginBottom: 6 }}>暂无导入任务</div>
          <div style={{ fontSize: 13 }}>点击右上角「+ 新建任务」创建一个新的导入任务，或在「样本接收」页面导入 CSV 时自动保存</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {filteredTasks.map((task) => {
            const mutable = canModifyTask(task)
            const isDraft = task.status === 'draft' || task.status === 'prevalidated'
            return (
              <div
                key={task.id}
                style={{
                  padding: 16,
                  background: '#fff',
                  borderRadius: 6,
                  border: `1px solid ${state.lastActiveTaskId === task.id ? '#409eff' : '#e8e8e8'}`,
                  boxShadow: state.lastActiveTaskId === task.id ? '0 0 0 2px rgba(64, 158, 255, 0.1)' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span
                        className="status-tag"
                        style={{ background: STATUS_COLORS[task.status] }}
                      >
                        {STATUS_LABELS[task.status]}
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 600, color: '#303133' }}>
                        {task.taskName}
                      </span>
                      {state.lastActiveTaskId === task.id && (
                        <span style={{
                          padding: '1px 6px',
                          fontSize: 11,
                          borderRadius: 3,
                          background: '#ecf5ff',
                          color: '#409eff',
                        }}>
                          当前活动
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#909399' }}>
                      创建人：{task.createdBy}
                      &nbsp;·&nbsp;创建于：{new Date(task.createdAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 13, color: '#606266', marginBottom: 8 }}>
                  <div>
                    <strong>批次：</strong>
                    {task.batchNo || (task.batchId ? state.batches.find((b) => b.id === task.batchId)?.batchNo : '-') || '-'}
                    &nbsp;&nbsp;
                    <strong>方案：</strong>
                    {task.schemeName || '-'}
                  </div>
                  {task.draftState.prevalidateSummary && (
                    <div style={{ marginTop: 2 }}>
                      <strong>预检结果：</strong>
                      共{task.draftState.prevalidateSummary.total}条，
                      <span style={{ color: '#52c41a' }}> 有效{task.draftState.prevalidateSummary.validCount}条</span>，
                      <span style={{ color: '#f56c6c' }}> 无效{task.draftState.prevalidateSummary.invalidCount}条</span>
                    </div>
                  )}
                  {task.importResultSnapshot && (
                    <div style={{ marginTop: 2 }}>
                      <strong>导入结果：</strong>
                      共{task.importResultSnapshot.totalCount}条，
                      <span style={{ color: '#52c41a' }}> 成功{task.importResultSnapshot.successCount}条</span>，
                      <span style={{ color: '#f56c6c' }}> 失败{task.importResultSnapshot.failedCount}条</span>
                      {task.completedAt && (
                        <>
                          &nbsp;·&nbsp;完成时间：{new Date(task.completedAt).toLocaleString('zh-CN')}
                        </>
                      )}
                    </div>
                  )}
                  {task.status === 'reverted' && (
                    <div style={{ marginTop: 2, color: '#f56c6c' }}>
                      <strong>撤销人：</strong>{task.revertedBy}
                      &nbsp;·&nbsp;<strong>撤销时间：</strong>{task.revertedAt && new Date(task.revertedAt).toLocaleString('zh-CN')}
                      {task.revertedReason && <>
                        &nbsp;·&nbsp;<strong>原因：</strong>{task.revertedReason}
                      </>}
                    </div>
                  )}
                  {task.draftState.fileName && (
                    <div style={{ marginTop: 2 }}>
                      <strong>文件：</strong>{task.draftState.fileName}
                    </div>
                  )}
                  <div style={{ marginTop: 2, fontSize: 12, color: '#909399' }}>
                    最近更新：{new Date(task.updatedAt).toLocaleString('zh-CN')}
                  </div>
                </div>

                {isDraft && renderDraftBadge(task)}

                <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                  {isDraft && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleResumeTask(task)}
                    >
                      ▶ 恢复继续
                    </button>
                  )}
                  <button
                    className="btn btn-default btn-sm"
                    onClick={() => openDetailModal(task)}
                  >
                    🔍 详情
                  </button>
                  <button
                    className="btn btn-default btn-sm"
                    onClick={() => openAuditModal(task)}
                  >
                    📜 操作记录
                  </button>
                  {mutable && isDraft && (
                    <button
                      className="btn btn-default btn-sm"
                      onClick={() => openRenameModal(task)}
                    >
                      ✏️ 重命名
                    </button>
                  )}
                  {mutable && isDraft && task.status !== 'cancelled' && (
                    <button
                      className="btn btn-default btn-sm"
                      onClick={() => handleCancelTask(task)}
                    >
                      取消任务
                    </button>
                  )}
                  {mutable && (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteTask(task)}
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showNewTaskModal && (
        <div className="modal-overlay" onClick={() => { setShowNewTaskModal(false); setNewTaskName(''); setErrorMsg('') }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">新建导入任务</div>
              <div className="modal-close" onClick={() => { setShowNewTaskModal(false); setNewTaskName(''); setErrorMsg('') }}>×</div>
            </div>
            <div className="modal-body">
              {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
              <div className="form-group">
                <label className="form-label">任务名称 *</label>
                <input
                  type="text"
                  className="form-input"
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  placeholder="例如：6月16日日常送检导入"
                  autoFocus
                />
              </div>
              <div style={{ fontSize: 12, color: '#909399', marginTop: -4 }}>
                创建后请前往「样本接收」页面，点击「CSV 批量导入」继续配置、预检和执行导入。
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => { setShowNewTaskModal(false); setNewTaskName(''); setErrorMsg('') }}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleCreateTask}>
                创建任务
              </button>
            </div>
          </div>
        </div>
      )}

      {showRenameModal && (
        <div className="modal-overlay" onClick={() => { setShowRenameModal(false); setRenameInput('') }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">重命名任务</div>
              <div className="modal-close" onClick={() => { setShowRenameModal(false); setRenameInput('') }}>×</div>
            </div>
            <div className="modal-body">
              {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
              <div className="form-group">
                <label className="form-label">新任务名称 *</label>
                <input
                  type="text"
                  className="form-input"
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => { setShowRenameModal(false); setRenameInput('') }}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleRenameTask}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {showDetailModal && selectedTask && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: '92vw' }}>
            <div className="modal-header">
              <div className="modal-title">任务详情 - {selectedTask.taskName}</div>
              <div className="modal-close" onClick={() => setShowDetailModal(false)}>×</div>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div className="card" style={{ marginBottom: 12 }}>
                <h4 style={{ marginBottom: 10 }}>基本信息</h4>
                <table className="table">
                  <tbody>
                    <tr><td style={{ width: 120 }}>任务ID</td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{selectedTask.id}</td></tr>
                    <tr><td>任务名称</td><td>{selectedTask.taskName}</td></tr>
                    <tr><td>状态</td><td>
                      <span className="status-tag" style={{ background: STATUS_COLORS[selectedTask.status] }}>
                        {STATUS_LABELS[selectedTask.status]}
                      </span>
                    </td></tr>
                    <tr><td>批次</td><td>{selectedTask.batchNo || (selectedTask.batchId ? state.batches.find((b) => b.id === selectedTask.batchId)?.batchNo : '-') || '-'}</td></tr>
                    <tr><td>导入方案</td><td>{selectedTask.schemeName || '-'}</td></tr>
                    <tr><td>创建人</td><td>{selectedTask.createdBy}</td></tr>
                    <tr><td>创建时间</td><td>{new Date(selectedTask.createdAt).toLocaleString('zh-CN')}</td></tr>
                    <tr><td>更新时间</td><td>{new Date(selectedTask.updatedAt).toLocaleString('zh-CN')}</td></tr>
                    {selectedTask.completedAt && (
                      <tr><td>完成时间</td><td>{new Date(selectedTask.completedAt).toLocaleString('zh-CN')}</td></tr>
                    )}
                    {selectedTask.status === 'reverted' && (
                      <>
                        <tr><td>撤销人</td><td>{selectedTask.revertedBy || '-'}</td></tr>
                        <tr><td>撤销时间</td><td>{selectedTask.revertedAt ? new Date(selectedTask.revertedAt).toLocaleString('zh-CN') : '-'}</td></tr>
                        <tr><td>撤销原因</td><td>{selectedTask.revertedReason || '-'}</td></tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="card" style={{ marginBottom: 12 }}>
                <h4 style={{ marginBottom: 10 }}>草稿状态快照</h4>
                <div style={{ fontSize: 13, color: '#606266' }}>
                  <div><strong>CSV 文件：</strong>{selectedTask.draftState.fileName || '-'}</div>
                  <div><strong>是否有CSV内容：</strong>{selectedTask.draftState.csvContent ? `有 (${(selectedTask.draftState.csvContent.length / 1024).toFixed(2)} KB)` : '无'}</div>
                  <div><strong>列映射：</strong>{selectedTask.draftState.columnMappings ? selectedTask.draftState.columnMappings.map((m) => `${m.csvColumn}→${m.targetField}`).join('、') : '-'}</div>
                  <div><strong>校验开关：</strong>
                    {selectedTask.draftState.validationToggles
                      ? Object.entries(selectedTask.draftState.validationToggles)
                        .filter(([, v]) => v)
                        .map(([k]) => {
                          const labels: Record<string, string> = {
                            skipEmptySampleNo: '空编号跳过', skipDuplicateInFile: 'CSV重复跳过',
                            skipDuplicateInBatch: '批次重复跳过', skipInvalidQuantity: '无效数量跳过', skipEmptySource: '空来源跳过',
                          }
                          return labels[k] || k
                        }).join('、') || '无跳过项（严格校验）'
                      : '-'}
                  </div>
                </div>
              </div>

              {selectedTask.draftState.prevalidateSummary && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <h4 style={{ marginBottom: 10 }}>预检结果</h4>
                  <div style={{
                    padding: 12,
                    borderRadius: 4,
                    marginBottom: 12,
                    background: selectedTask.draftState.prevalidateSummary.canImport ? '#f6ffed' : '#fff2f0',
                    border: `1px solid ${selectedTask.draftState.prevalidateSummary.canImport ? '#b7eb8f' : '#ffa39e'}`,
                  }}>
                    共 <strong>{selectedTask.draftState.prevalidateSummary.total}</strong> 条，
                    <span style={{ color: '#52c41a' }}> 有效 {selectedTask.draftState.prevalidateSummary.validCount} 条</span>，
                    <span style={{ color: '#f5222d' }}> 无效 {selectedTask.draftState.prevalidateSummary.invalidCount} 条</span>
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e8e8e8', borderRadius: 4 }}>
                    <table className="table" style={{ margin: 0 }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                        <tr><th>行号</th><th>样本编号</th><th>数量</th><th>来源</th><th>状态</th><th>说明</th></tr>
                      </thead>
                      <tbody>
                        {selectedTask.draftState.prevalidateSummary.results.map((r) => (
                          <tr key={r.rowIndex} style={{ background: r.valid ? 'transparent' : '#fff2f0' }}>
                            <td>{r.rowIndex}</td>
                            <td>{r.sampleNo || '-'}</td>
                            <td>{r.quantity || '-'}</td>
                            <td>{r.source || '-'}</td>
                            <td>
                              <span className="status-tag" style={{ background: r.valid ? '#52c41a' : '#f5222d' }}>
                                {r.valid ? '通过' : '失败'}
                              </span>
                            </td>
                            <td style={{ color: '#f5222d', fontSize: 12 }}>{r.errors.join('；')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedTask.importResultSnapshot && (
                <div className="card">
                  <h4 style={{ marginBottom: 10 }}>导入结果</h4>
                  <div style={{
                    padding: 12,
                    borderRadius: 4,
                    marginBottom: 12,
                    background: '#f6ffed',
                    border: '1px solid #b7eb8f',
                  }}>
                    共 <strong>{selectedTask.importResultSnapshot.totalCount}</strong> 条，
                    <span style={{ color: '#52c41a' }}> 成功 {selectedTask.importResultSnapshot.successCount} 条</span>，
                    <span style={{ color: '#f5222d' }}> 失败 {selectedTask.importResultSnapshot.failedCount} 条</span>
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e8e8e8', borderRadius: 4 }}>
                    <table className="table" style={{ margin: 0 }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                        <tr><th>行号</th><th>样本编号</th><th>状态</th><th>说明</th></tr>
                      </thead>
                      <tbody>
                        {selectedTask.importResultSnapshot.details.map((d) => (
                          <tr key={d.rowIndex} style={{ background: d.success ? 'transparent' : '#fff2f0' }}>
                            <td>{d.rowIndex}</td>
                            <td>{d.sampleNo || '-'}</td>
                            <td>
                              <span className="status-tag" style={{ background: d.success ? '#52c41a' : '#f5222d' }}>
                                {d.success ? '成功' : '失败'}
                              </span>
                            </td>
                            <td style={{ color: '#f5222d', fontSize: 12 }}>{d.error || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShowDetailModal(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuditModal && (
        <div className="modal-overlay" onClick={() => setShowAuditModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 650, maxWidth: '90vw' }}>
            <div className="modal-header">
              <div className="modal-title">操作记录{selectedTask ? ` - ${selectedTask.taskName}` : ''}</div>
              <div className="modal-close" onClick={() => setShowAuditModal(false)}>×</div>
            </div>
            <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
              {auditLogs.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#909399' }}>暂无操作记录</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>时间</th><th>操作</th><th>操作人</th><th>详情</th></tr>
                  </thead>
                  <tbody>
                    {[...auditLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((log) => (
                      <tr key={log.id}>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(log.timestamp).toLocaleString('zh-CN')}</td>
                        <td>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: 3,
                            fontSize: 12,
                            background: '#ecf5ff',
                            color: '#409eff',
                          }}>
                            {({
                              create: '创建',
                              update_draft: '更新草稿',
                              resume: '恢复',
                              prevalidate: '预检',
                              execute: '执行导入',
                              cancel: '取消',
                              revert: '撤销',
                              delete: '删除',
                              rename: '重命名',
                            } as any)[log.action] || log.action}
                          </span>
                        </td>
                        <td>{log.operatorName}</td>
                        <td style={{ fontSize: 13 }}>{log.detail || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => setShowAuditModal(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showRevertModal && (
        <div className="modal-overlay" onClick={() => { setShowRevertModal(false); setRevertReason('') }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">撤销最近一次导入</div>
              <div className="modal-close" onClick={() => { setShowRevertModal(false); setRevertReason('') }}>×</div>
            </div>
            <div className="modal-body">
              {lastImportResult && (
                <div style={{
                  padding: 14,
                  background: '#fff7e6',
                  border: '1px solid #ffd591',
                  borderRadius: 4,
                  marginBottom: 16,
                  fontSize: 13,
                }}>
                  <div><strong>批次：</strong>{state.batches.find((b) => b.id === lastImportResult.batchId)?.batchNo || '-'}</div>
                  <div><strong>操作时间：</strong>{new Date(lastImportResult.timestamp).toLocaleString('zh-CN')}</div>
                  <div><strong>成功：</strong><span style={{ color: '#52c41a' }}>{lastImportResult.successCount} 条样本</span>（将被删除）</div>
                  <div><strong>失败：</strong>{lastImportResult.failedCount} 条（无影响）</div>
                  <div><strong>操作人：</strong>{lastImportResult.operatorName}</div>
                  {lastSnapshot?.taskId && (
                    <div><strong>关联任务：</strong>{state.importTasks.find((t) => t.id === lastSnapshot.taskId)?.taskName || '-'}</div>
                  )}
                </div>
              )}
              <div style={{ padding: 12, background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 4, marginBottom: 16, fontSize: 13, color: '#cf1322' }}>
                ⚠️ 此操作将<strong>永久删除</strong>本次批量导入成功的所有样本及其台账记录，台账对应的流程历史将一并移除。此操作不可恢复。
              </div>
              <div className="form-group">
                <label className="form-label">撤销原因（可选）</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={revertReason}
                  onChange={(e) => setRevertReason(e.target.value)}
                  placeholder="例如：导入错误、重复导入等..."
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => { setShowRevertModal(false); setRevertReason('') }}>
                取消
              </button>
              <button className="btn btn-danger" onClick={handleRevertImport}>
                确认撤销（不可恢复）
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ImportTaskCenter
