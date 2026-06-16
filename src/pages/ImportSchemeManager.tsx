import { useState, useRef } from 'react'
import { useApp } from '../store/AppContext'
import { ImportScheme, ConflictResolution } from '../types'

function ImportSchemeManager() {
  const {
    state,
    createImportScheme,
    renameImportScheme,
    copyImportScheme,
    deleteImportScheme,
    modifyImportScheme,
    lockScheme,
    unlockScheme,
    exportSchemesJSON,
    importSchemesJSON,
    canModifyScheme,
    setLastSelectedScheme,
    getSchemeAuditLog,
    doExportJSON,
    getCurrentUser,
  } = useApp()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newSchemeName, setNewSchemeName] = useState('')
  const [editingScheme, setEditingScheme] = useState<ImportScheme | null>(null)
  const [renamingScheme, setRenamingScheme] = useState<ImportScheme | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [copyingScheme, setCopyingScheme] = useState<ImportScheme | null>(null)
  const [copyValue, setCopyValue] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [conflictResolution, setConflictResolution] = useState<ConflictResolution>('skip')
  const [importJSONText, setImportJSONText] = useState('')
  const [importResult, setImportResult] = useState<{
    success: boolean
    importedCount: number
    skippedCount: number
    overwrittenCount: number
    error?: string
  } | null>(null)
  const [detectedConflicts, setDetectedConflicts] = useState<{
    schemeName: string
    existingName: string
    canOverwrite: boolean
  }[]>([])
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const importFileRef = useRef<HTMLInputElement>(null)

  const currentUser = getCurrentUser()

  const handleCreate = () => {
    if (!newSchemeName.trim()) {
      setErrorMsg('请输入方案名称')
      return
    }
    if (state.importSchemes.some((s) => s.name === newSchemeName.trim())) {
      setErrorMsg('同名方案已存在')
      return
    }
    createImportScheme(newSchemeName.trim())
    setNewSchemeName('')
    setShowCreateModal(false)
    setErrorMsg('')
    setSuccessMsg(`方案「${newSchemeName.trim()}」已创建`)
  }

  const handleRename = () => {
    if (!renamingScheme || !renameValue.trim()) return
    if (state.importSchemes.some((s) => s.name === renameValue.trim() && s.id !== renamingScheme.id)) {
      setErrorMsg('同名方案已存在')
      return
    }
    const result = renameImportScheme(renamingScheme.id, renameValue.trim())
    if (result.success) {
      setRenamingScheme(null)
      setRenameValue('')
      setErrorMsg('')
      setSuccessMsg(`方案已重命名为「${renameValue.trim()}」`)
    } else {
      setErrorMsg(result.error || '重命名失败')
    }
  }

  const handleCopy = () => {
    if (!copyingScheme || !copyValue.trim()) return
    if (state.importSchemes.some((s) => s.name === copyValue.trim())) {
      setErrorMsg('同名方案已存在')
      return
    }
    const result = copyImportScheme(copyingScheme.id, copyValue.trim())
    if (result.success) {
      setCopyingScheme(null)
      setCopyValue('')
      setErrorMsg('')
      setSuccessMsg(`已复制为「${copyValue.trim()}」`)
    } else {
      setErrorMsg(result.error || '复制失败')
    }
  }

  const handleDelete = (scheme: ImportScheme) => {
    if (!canModifyScheme(scheme)) {
      setErrorMsg('无权删除此方案（他人锁定共享方案）')
      return
    }
    const result = deleteImportScheme(scheme.id)
    if (result.success) {
      setSuccessMsg(`方案「${scheme.name}」已删除`)
    } else {
      setErrorMsg(result.error || '删除失败')
    }
  }

  const handleToggleLock = (scheme: ImportScheme) => {
    if (scheme.isLocked) {
      const result = unlockScheme(scheme.id)
      if (result.success) {
        setSuccessMsg(`方案「${scheme.name}」已解锁`)
      } else {
        setErrorMsg(result.error || '解锁失败')
      }
    } else {
      const result = lockScheme(scheme.id)
      if (result.success) {
        setSuccessMsg(`方案「${scheme.name}」已锁定并共享`)
      } else {
        setErrorMsg(result.error || '锁定失败')
      }
    }
  }

  const handleToggleShared = (scheme: ImportScheme) => {
    const result = modifyImportScheme(scheme.id, { isShared: !scheme.isShared })
    if (result.success) {
      setSuccessMsg(`方案「${scheme.name}」${scheme.isShared ? '已取消共享' : '已设为共享'}`)
    } else {
      setErrorMsg(result.error || '操作失败')
    }
  }

  const handleExport = (schemes: ImportScheme[]) => {
    const ids = schemes.map((s) => s.id)
    const json = exportSchemesJSON(ids)
    doExportJSON(json, `导入方案_${new Date().toISOString().slice(0, 10)}.json`)
    setSuccessMsg(`已导出 ${schemes.length} 个方案`)
  }

  const detectConflicts = (jsonText: string) => {
    if (!jsonText.trim()) {
      setDetectedConflicts([])
      return
    }
    try {
      const data = JSON.parse(jsonText)
      if (!data.schemes || !Array.isArray(data.schemes)) {
        setDetectedConflicts([])
        return
      }
      const conflicts: { schemeName: string; existingName: string; canOverwrite: boolean }[] = []
      for (const scheme of data.schemes) {
        const existing = state.importSchemes.find((s) => s.name === scheme.name)
        if (existing) {
          conflicts.push({
            schemeName: scheme.name,
            existingName: existing.name,
            canOverwrite: canModifyScheme(existing),
          })
        }
      }
      setDetectedConflicts(conflicts)
    } catch {
      setDetectedConflicts([])
    }
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setImportJSONText(content)
      detectConflicts(content)
    }
    reader.readAsText(file)
  }

  const handleImportConfirm = () => {
    if (!importJSONText.trim()) {
      setErrorMsg('请输入或选择 JSON 文件')
      return
    }
    const result = importSchemesJSON(importJSONText, conflictResolution)
    setImportResult(result)
    if (result.success) {
      setSuccessMsg(`导入完成：新增 ${result.importedCount}，覆盖 ${result.overwrittenCount}，跳过 ${result.skippedCount}`)
      setImportJSONText('')
      setDetectedConflicts([])
    } else {
      setErrorMsg(result.error || '导入失败')
    }
  }

  const handleCloseImportModal = () => {
    setShowImportModal(false)
    setImportJSONText('')
    setImportResult(null)
    setConflictResolution('skip')
    setDetectedConflicts([])
    if (importFileRef.current) {
      importFileRef.current.value = ''
    }
  }

  const handleSaveScheme = (scheme: ImportScheme) => {
    const result = modifyImportScheme(scheme.id, editingScheme!)
    if (result.success) {
      setEditingScheme(null)
      setSuccessMsg(`方案「${scheme.name}」已保存`)
    } else {
      setErrorMsg(result.error || '保存失败')
    }
  }

  const AUDIT_ACTION_LABELS: Record<string, string> = {
    create: '创建',
    rename: '重命名',
    copy: '复制',
    delete: '删除',
    modify: '修改',
    import: '导入',
    export: '导出',
    lock: '锁定',
    unlock: '解锁',
  }

  const allAuditLogs = [...state.schemeAuditLog].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">导入方案管理</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-default" onClick={() => setShowImportModal(true)}>
            📥 导入方案
          </button>
          {state.importSchemes.length > 0 && (
            <button className="btn btn-default" onClick={() => handleExport(state.importSchemes)}>
              📤 导出全部
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            + 新建方案
          </button>
        </div>
      </div>

      {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      <div style={{ marginBottom: 16, padding: 12, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4 }}>
        <span style={{ fontSize: 14, color: '#d48806' }}>
          💡 <strong>提示：</strong>保存列映射、默认批次信息和校验开关为可复用方案，下次导入 CSV 时直接套用。方案支持重命名、复制、删除、导入导出 JSON，以及锁定共享防误改。重启应用后方案和最近选择仍保留。
        </span>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>方案列表（{state.importSchemes.length}）</h3>
        {state.importSchemes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#999' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <div style={{ fontSize: 16, marginBottom: 8 }}>暂无导入方案</div>
            <div style={{ fontSize: 13 }}>点击右上角「+ 新建方案」创建可复用的导入配置</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {state.importSchemes.map((scheme) => (
              <SchemeCard
                key={scheme.id}
                scheme={scheme}
                currentUserId={state.currentUserId}
                canModify={canModifyScheme(scheme)}
                isSelected={state.lastSelectedSchemeId === scheme.id}
                onSelect={() => setLastSelectedScheme(scheme.id)}
                onEdit={() => setEditingScheme({ ...scheme })}
                onRename={() => { setRenamingScheme(scheme); setRenameValue(scheme.name) }}
                onCopy={() => { setCopyingScheme(scheme); setCopyValue(scheme.name + '-副本') }}
                onDelete={() => handleDelete(scheme)}
                onToggleLock={() => handleToggleLock(scheme)}
                onToggleShared={() => handleToggleShared(scheme)}
                onExport={() => handleExport([scheme])}
                auditLogs={getSchemeAuditLog(scheme.id)}
                expandedAudit={expandedAuditId === scheme.id}
                onToggleAudit={() => setExpandedAuditId(expandedAuditId === scheme.id ? null : scheme.id)}
                auditActionLabels={AUDIT_ACTION_LABELS}
              />
            ))}
          </div>
        )}
      </div>

      {allAuditLogs.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>操作留痕</h3>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table className="table">
              <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                <tr>
                  <th>时间</th>
                  <th>方案名称</th>
                  <th>操作</th>
                  <th>操作人</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {allAuditLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(log.timestamp).toLocaleString('zh-CN')}
                    </td>
                    <td>{log.schemeName}</td>
                    <td>
                      <span className="status-tag" style={{
                        background: log.action === 'delete' ? '#f5222d' :
                          log.action === 'create' ? '#52c41a' :
                          log.action === 'import' ? '#1890ff' :
                          log.action === 'export' ? '#722ed1' : '#faad14'
                      }}>
                        {AUDIT_ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td>{log.operatorName}</td>
                    <td style={{ fontSize: 12, color: '#666' }}>{log.detail || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">新建导入方案</div>
              <div className="modal-close" onClick={() => setShowCreateModal(false)}>×</div>
            </div>
            <div className="modal-body">
              {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
              <div className="form-group">
                <label className="form-label">方案名称 *</label>
                <input
                  type="text"
                  className="form-input"
                  value={newSchemeName}
                  onChange={(e) => setNewSchemeName(e.target.value)}
                  placeholder="例如：日常送检方案"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => { setShowCreateModal(false); setErrorMsg('') }}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate}>创建</button>
            </div>
          </div>
        </div>
      )}

      {renamingScheme && (
        <div className="modal-overlay" onClick={() => { setRenamingScheme(null); setErrorMsg('') }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">重命名方案</div>
              <div className="modal-close" onClick={() => { setRenamingScheme(null); setErrorMsg('') }}>×</div>
            </div>
            <div className="modal-body">
              {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
              <div className="form-group">
                <label className="form-label">新名称</label>
                <input
                  type="text"
                  className="form-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => { setRenamingScheme(null); setErrorMsg('') }}>取消</button>
              <button className="btn btn-primary" onClick={handleRename}>确认</button>
            </div>
          </div>
        </div>
      )}

      {copyingScheme && (
        <div className="modal-overlay" onClick={() => { setCopyingScheme(null); setErrorMsg('') }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">复制方案</div>
              <div className="modal-close" onClick={() => { setCopyingScheme(null); setErrorMsg('') }}>×</div>
            </div>
            <div className="modal-body">
              {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
              <div className="form-group">
                <label className="form-label">副本名称</label>
                <input
                  type="text"
                  className="form-input"
                  value={copyValue}
                  onChange={(e) => setCopyValue(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => { setCopyingScheme(null); setErrorMsg('') }}>取消</button>
              <button className="btn btn-primary" onClick={handleCopy}>确认复制</button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={handleCloseImportModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 600, maxWidth: '90vw' }}>
            <div className="modal-header">
              <div className="modal-title">导入方案 JSON</div>
              <div className="modal-close" onClick={handleCloseImportModal}>×</div>
            </div>
            <div className="modal-body">
              {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
              {!importResult ? (
                <>
                  <div className="form-group">
                    <label className="form-label">选择 JSON 文件</label>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".json"
                      onChange={handleImportFile}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">或粘贴 JSON 内容</label>
                    <textarea
                      className="form-textarea"
                      value={importJSONText}
                      onChange={(e) => {
                        setImportJSONText(e.target.value)
                        detectConflicts(e.target.value)
                      }}
                      rows={6}
                      placeholder='{"version":1,"schemes":[...]}'
                    />
                  </div>

                  {detectedConflicts.length > 0 && (
                    <div style={{
                      padding: '12px 14px',
                      background: '#fff7e6',
                      border: '1px solid #ffd591',
                      borderRadius: 4,
                      marginBottom: 16,
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 8, color: '#d46b08' }}>
                        ⚠️ 检测到 {detectedConflicts.length} 个同名冲突
                      </div>
                      <div style={{ fontSize: 13, maxHeight: 150, overflowY: 'auto' }}>
                        {detectedConflicts.map((c, idx) => (
                          <div key={idx} style={{ padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>• 「{c.schemeName}」</span>
                            {c.canOverwrite ? (
                              <span className="status-tag" style={{ background: '#faad14', fontSize: 11 }}>可覆盖</span>
                            ) : (
                              <span className="status-tag" style={{ background: '#999', fontSize: 11 }}>只读（无法覆盖）</span>
                            )}
                          </div>
                        ))}
                      </div>
                      {detectedConflicts.some(c => !c.canOverwrite) && (
                        <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                          标记为「只读」的方案为他人锁定共享，无论选择何种处理方式都将被跳过
                        </div>
                      )}
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label">同名冲突处理</label>
                    <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="conflict"
                          checked={conflictResolution === 'skip'}
                          onChange={() => setConflictResolution('skip')}
                        />
                        跳过（保留现有方案）
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="conflict"
                          checked={conflictResolution === 'overwrite'}
                          onChange={() => setConflictResolution('overwrite')}
                        />
                        覆盖（替换现有方案）
                      </label>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{
                  padding: 16,
                  borderRadius: 4,
                  background: '#f6ffed',
                  border: '1px solid #b7eb8f',
                }}>
                  <strong>✅ 导入完成</strong>
                  <div style={{ marginTop: 8, fontSize: 14 }}>
                    <div>新增：<strong>{importResult.importedCount}</strong> 个</div>
                    <div>覆盖：<strong>{importResult.overwrittenCount}</strong> 个</div>
                    <div>跳过：<strong>{importResult.skippedCount}</strong> 个</div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={handleCloseImportModal}>
                {importResult ? '完成' : '取消'}
              </button>
              {!importResult && (
                <button className="btn btn-primary" onClick={handleImportConfirm}>确认导入</button>
              )}
            </div>
          </div>
        </div>
      )}

      {editingScheme && (
        <div className="modal-overlay" onClick={() => setEditingScheme(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 700, maxWidth: '90vw' }}>
            <div className="modal-header">
              <div className="modal-title">编辑方案：{editingScheme.name}</div>
              <div className="modal-close" onClick={() => setEditingScheme(null)}>×</div>
            </div>
            <div className="modal-body">
              <h4 style={{ marginBottom: 12 }}>列映射</h4>
              <div style={{ marginBottom: 16 }}>
                {editingScheme.columnMappings.map((mapping, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input
                      type="text"
                      className="form-input"
                      style={{ flex: 1 }}
                      value={mapping.csvColumn}
                      onChange={(e) => {
                        const newMappings = [...editingScheme.columnMappings]
                        newMappings[idx] = { ...newMappings[idx], csvColumn: e.target.value }
                        setEditingScheme({ ...editingScheme, columnMappings: newMappings })
                      }}
                      placeholder="CSV列名"
                    />
                    <span style={{ fontSize: 16 }}>→</span>
                    <select
                      className="form-input"
                      style={{ flex: 1 }}
                      value={mapping.targetField}
                      onChange={(e) => {
                        const newMappings = [...editingScheme.columnMappings]
                        newMappings[idx] = { ...newMappings[idx], targetField: e.target.value }
                        setEditingScheme({ ...editingScheme, columnMappings: newMappings })
                      }}
                    >
                      <option value="sampleNo">样本编号</option>
                      <option value="quantity">数量</option>
                      <option value="source">来源</option>
                    </select>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        const newMappings = editingScheme.columnMappings.filter((_, i) => i !== idx)
                        setEditingScheme({ ...editingScheme, columnMappings: newMappings })
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))}
                <button
                  className="btn btn-default btn-sm"
                  onClick={() => {
                    setEditingScheme({
                      ...editingScheme,
                      columnMappings: [...editingScheme.columnMappings, { csvColumn: '', targetField: 'sampleNo' }],
                    })
                  }}
                >
                  + 添加列映射
                </button>
              </div>

              <h4 style={{ marginBottom: 12 }}>默认批次信息</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div className="form-group">
                  <label className="form-label">批次号模式</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editingScheme.defaultBatch.batchNoPattern}
                    onChange={(e) => setEditingScheme({
                      ...editingScheme,
                      defaultBatch: { ...editingScheme.defaultBatch, batchNoPattern: e.target.value },
                    })}
                    placeholder="例如：BATCH-{DATE}"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">批次名称模式</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editingScheme.defaultBatch.batchNamePattern}
                    onChange={(e) => setEditingScheme({
                      ...editingScheme,
                      defaultBatch: { ...editingScheme.defaultBatch, batchNamePattern: e.target.value },
                    })}
                    placeholder="例如：日常送检"
                  />
                </div>
              </div>

              <h4 style={{ marginBottom: 12 }}>校验开关（勾选=启用校验，不勾选=跳过校验）</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={!editingScheme.validationToggles.skipEmptySampleNo}
                    onChange={(e) => setEditingScheme({
                      ...editingScheme,
                      validationToggles: { ...editingScheme.validationToggles, skipEmptySampleNo: !e.target.checked },
                    })}
                  />
                  校验空样本编号
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={!editingScheme.validationToggles.skipDuplicateInFile}
                    onChange={(e) => setEditingScheme({
                      ...editingScheme,
                      validationToggles: { ...editingScheme.validationToggles, skipDuplicateInFile: !e.target.checked },
                    })}
                  />
                  校验CSV内重复编号
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={!editingScheme.validationToggles.skipDuplicateInBatch}
                    onChange={(e) => setEditingScheme({
                      ...editingScheme,
                      validationToggles: { ...editingScheme.validationToggles, skipDuplicateInBatch: !e.target.checked },
                    })}
                  />
                  校验批次内已存在编号
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={!editingScheme.validationToggles.skipInvalidQuantity}
                    onChange={(e) => setEditingScheme({
                      ...editingScheme,
                      validationToggles: { ...editingScheme.validationToggles, skipInvalidQuantity: !e.target.checked },
                    })}
                  />
                  校验无效数量
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={!editingScheme.validationToggles.skipEmptySource}
                    onChange={(e) => setEditingScheme({
                      ...editingScheme,
                      validationToggles: { ...editingScheme.validationToggles, skipEmptySource: !e.target.checked },
                    })}
                  />
                  校验空来源
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => setEditingScheme(null)}>取消</button>
              <button className="btn btn-primary" onClick={() => handleSaveScheme(editingScheme)}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SchemeCard({
  scheme,
  currentUserId,
  canModify,
  isSelected,
  onSelect,
  onEdit,
  onRename,
  onCopy,
  onDelete,
  onToggleLock,
  onToggleShared,
  onExport,
  auditLogs,
  expandedAudit,
  onToggleAudit,
  auditActionLabels,
}: {
  scheme: ImportScheme
  currentUserId: string | null
  canModify: boolean
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onRename: () => void
  onCopy: () => void
  onDelete: () => void
  onToggleLock: () => void
  onToggleShared: () => void
  onExport: () => void
  auditLogs: { id: string; action: string; timestamp: string; operatorName: string; detail?: string }[]
  expandedAudit: boolean
  onToggleAudit: () => void
  auditActionLabels: Record<string, string>
}) {
  const isOwner = scheme.createdById === currentUserId

  return (
    <div style={{
      border: `1px solid ${isSelected ? '#1890ff' : '#e8e8e8'}`,
      borderRadius: 4,
      overflow: 'hidden',
      background: isSelected ? '#f0f7ff' : 'transparent',
    }}>
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <input
            type="radio"
            checked={isSelected}
            onChange={onSelect}
            style={{ cursor: 'pointer' }}
          />
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{scheme.name}</span>
            <div style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
              {scheme.isShared && (
                <span className="status-tag" style={{ background: '#1890ff' }}>共享</span>
              )}
              {scheme.isLocked && (
                <span className="status-tag" style={{ background: '#f5222d' }}>🔒锁定</span>
              )}
              {!canModify && (
                <span className="status-tag" style={{ background: '#999' }}>只读</span>
              )}
            </div>
          </div>
          <div className="action-buttons">
            {canModify && (
              <button className="btn btn-default btn-sm" onClick={onEdit}>编辑</button>
            )}
            {canModify && (
              <button className="btn btn-default btn-sm" onClick={onRename}>重命名</button>
            )}
            <button className="btn btn-default btn-sm" onClick={onCopy}>复制</button>
            {canModify && (
              <button className="btn btn-danger btn-sm" onClick={onDelete}>删除</button>
            )}
            {isOwner && (
              <button
                className={`btn btn-sm ${scheme.isLocked ? 'btn-warning' : 'btn-default'}`}
                onClick={onToggleLock}
              >
                {scheme.isLocked ? '🔓解锁' : '🔒锁定'}
              </button>
            )}
            {canModify && !scheme.isLocked && (
              <button className="btn btn-default btn-sm" onClick={onToggleShared}>
                {scheme.isShared ? '取消共享' : '设为共享'}
              </button>
            )}
            <button className="btn btn-default btn-sm" onClick={onExport}>导出</button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#666', marginLeft: 22 }}>
          <span>创建人：{scheme.createdBy}</span>
          <span style={{ marginLeft: 16 }}>列映射：{scheme.columnMappings.length} 项</span>
          <span style={{ marginLeft: 16 }}>批次号模式：{scheme.defaultBatch.batchNoPattern || '未设置'}</span>
          <span style={{ marginLeft: 16 }}>
            更新于：{new Date(scheme.updatedAt).toLocaleString('zh-CN')}
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#666', marginLeft: 22, marginTop: 4 }}>
          已启用校验：
          {Object.entries(scheme.validationToggles)
            .filter(([, v]) => !v)
            .map(([k]) => {
              const labels: Record<string, string> = {
                skipEmptySampleNo: '空编号',
                skipDuplicateInFile: 'CSV重复',
                skipDuplicateInBatch: '批次重复',
                skipInvalidQuantity: '无效数量',
                skipEmptySource: '空来源',
              }
              return labels[k] || k
            })
            .join('、') || '无'}
        </div>
        <div style={{ fontSize: 12, color: '#999', marginLeft: 22, marginTop: 2 }}>
          已关闭校验（跳过）：
          {Object.entries(scheme.validationToggles)
            .filter(([, v]) => v)
            .map(([k]) => {
              const labels: Record<string, string> = {
                skipEmptySampleNo: '空编号',
                skipDuplicateInFile: 'CSV重复',
                skipDuplicateInBatch: '批次重复',
                skipInvalidQuantity: '无效数量',
                skipEmptySource: '空来源',
              }
              return labels[k] || k
            })
            .join('、') || '无'}
        </div>
        {auditLogs.length > 0 && (
          <div style={{ marginTop: 8, marginLeft: 22 }}>
            <span
              style={{ fontSize: 12, color: '#1890ff', cursor: 'pointer' }}
              onClick={onToggleAudit}
            >
              {expandedAudit ? '▼' : '▶'} 操作记录（{auditLogs.length}）
            </span>
            {expandedAudit && (
              <div style={{ marginTop: 8, fontSize: 12, maxHeight: 200, overflowY: 'auto' }}>
                <table className="table" style={{ margin: 0 }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                    <tr>
                      <th>时间</th>
                      <th>操作</th>
                      <th>操作人</th>
                      <th>详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...auditLogs]
                      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                      .map((log) => (
                        <tr key={log.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.timestamp).toLocaleString('zh-CN')}</td>
                          <td>{auditActionLabels[log.action] || log.action}</td>
                          <td>{log.operatorName}</td>
                          <td style={{ color: '#666' }}>{log.detail || '-'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ImportSchemeManager
