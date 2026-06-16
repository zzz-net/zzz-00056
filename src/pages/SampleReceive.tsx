import { useState, useRef, useEffect } from 'react'
import { useApp } from '../store/AppContext'
import { STATUS_LABELS, STATUS_COLORS, PrevalidateSummary, ValidationToggles, SchemeChangeEvent, ConflictResolution } from '../types'

function SampleReceive() {
  const {
    state,
    createBatch,
    addSample,
    getCurrentUser,
    parseCSV,
    parseCSVWithScheme,
    prevalidateImportCSV,
    batchImportSamples,
    doExportCSV,
    setLastSelectedScheme,
    resolveDefaultBatch,
    clearLastSchemeChange,
    isLastSelectedSchemeValid,
    importSchemesJSON,
    exportSchemesJSON,
    doExportJSON,
    createImportTask,
    updateImportTaskDraft,
    completeImportTask,
    setLastActiveTask,
    buildImportValidationPipeline,
    canRevertLastImport,
    revertLastImport,
  } = useApp()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchNo, setBatchNo] = useState('')
  const [batchName, setBatchName] = useState('')

  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [sampleNo, setSampleNo] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [source, setSource] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const [showImportModal, setShowImportModal] = useState(false)
  const [selectedSchemeId, setSelectedSchemeId] = useState<string>(state.lastSelectedSchemeId || '')
  const [prevalidateResult, setPrevalidateResult] = useState<PrevalidateSummary | null>(null)
  const [importedResult, setImportedResult] = useState<{ successCount: number; failedCount: number } | null>(null)
  const [schemeChangeNotice, setSchemeChangeNotice] = useState<{ type: string; message: string } | null>(null)
  const lastProcessedChangeRef = useRef<string | null>(null)

  const [importModalBatchNo, setImportModalBatchNo] = useState('')
  const [importModalBatchName, setImportModalBatchName] = useState('')
  const [showQuickBatchModal, setShowQuickBatchModal] = useState(false)
  const [quickBatchErrorMsg, setQuickBatchErrorMsg] = useState('')
  const [pendingCSVContent, setPendingCSVContent] = useState<string | null>(null)
  const [pendingFileName, setPendingFileName] = useState<string | null>(null)

  const [showQuickSchemeImportModal, setShowQuickSchemeImportModal] = useState(false)
  const [quickSchemeImportJSON, setQuickSchemeImportJSON] = useState('')
  const [quickSchemeImportResult, setQuickSchemeImportResult] = useState<{
    success: boolean; importedCount: number; skippedCount: number; overwrittenCount: number; error?: string
  } | null>(null)
  const [quickSchemeConflictResolution, setQuickSchemeConflictResolution] = useState<ConflictResolution>('skip')

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [taskName, setTaskName] = useState('')
  const [showResumePrompt, setShowResumePrompt] = useState(false)
  const [showSaveTaskPrompt, setShowSaveTaskPrompt] = useState(false)
  const [showNewTaskPrompt, setShowNewTaskPrompt] = useState(false)
  const [showRevertConfirm, setShowRevertConfirm] = useState(false)
  const [revertReason, setRevertReason] = useState('')

  useEffect(() => {
    if (!state.lastSchemeChange) {
      return
    }

    const changeKey = `${state.lastSchemeChange.type}-${state.lastSchemeChange.schemeId}-${state.lastSchemeChange.timestamp}`
    if (lastProcessedChangeRef.current === changeKey) {
      return
    }
    lastProcessedChangeRef.current = changeKey

    const isLastSelected = state.lastSchemeChange.affectedLastSelected

    let notice: { type: string; message: string } | null = null

    switch (state.lastSchemeChange.type) {
      case 'delete':
        if (isLastSelected) {
          notice = {
            type: 'warning',
            message: `您之前选择的方案「${state.lastSchemeChange.schemeName}」已被删除，已自动切换为默认配置。`,
          }
        }
        break
      case 'rename':
        if (isLastSelected && state.lastSchemeChange.oldName) {
          notice = {
            type: 'info',
            message: `您当前选择的方案已重命名：「${state.lastSchemeChange.oldName}」→「${state.lastSchemeChange.schemeName}」`,
          }
        }
        break
      case 'overwrite':
        if (isLastSelected) {
          notice = {
            type: 'warning',
            message: `您当前选择的方案「${state.lastSchemeChange.schemeName}」已被 JSON 导入覆盖，请注意核对列映射、校验开关等配置。`,
          }
        }
        break
      case 'update':
        if (isLastSelected) {
          notice = {
            type: 'info',
            message: `您当前选择的方案「${state.lastSchemeChange.schemeName}」配置已更新。`,
          }
        }
        break
      case 'lock':
        if (isLastSelected) {
          notice = {
            type: 'info',
            message: `您当前选择的方案「${state.lastSchemeChange.schemeName}」已被锁定并共享。`,
          }
        }
        break
      case 'unlock':
        if (isLastSelected) {
          notice = {
            type: 'info',
            message: `您当前选择的方案「${state.lastSchemeChange.schemeName}」已解锁。`,
          }
        }
        break
    }

    if (notice && showImportModal) {
      setSchemeChangeNotice(notice)
    }
  }, [state.lastSchemeChange, showImportModal])

  useEffect(() => {
    const valid = isLastSelectedSchemeValid()
    if (!valid && state.lastSelectedSchemeId) {
      setSchemeChangeNotice({
        type: 'warning',
        message: '之前选择的导入方案已不存在，已切换为默认配置。',
      })
    }
  }, [])

  const handleCreateBatch = () => {
    if (!batchNo.trim()) {
      setErrorMsg('请输入批次编号')
      return
    }
    const exists = state.batches.some((b) => b.batchNo === batchNo.trim())
    if (exists) {
      setErrorMsg('批次编号已存在')
      return
    }
    createBatch(batchNo.trim(), batchName.trim())
    setShowBatchModal(false)
    setBatchNo('')
    setBatchName('')
    setErrorMsg('')
  }

  const handleAddSample = () => {
    setErrorMsg('')
    setSuccessMsg('')

    if (!selectedBatchId) {
      setErrorMsg('请先选择批次')
      return
    }
    if (!sampleNo.trim()) {
      setErrorMsg('请输入样本编号')
      return
    }
    if (quantity < 1) {
      setErrorMsg('数量必须大于0')
      return
    }
    if (!source.trim()) {
      setErrorMsg('请输入样本来源')
      return
    }

    const user = getCurrentUser()
    const result = addSample({
      batchId: selectedBatchId,
      sampleNo: sampleNo.trim(),
      quantity,
      source: source.trim(),
      status: 'received',
      receivedAt: new Date().toISOString(),
      receivedBy: user?.username || '未知',
    })

    if (result.success) {
      setSuccessMsg(`样本 ${sampleNo} 接收成功！`)
      setSampleNo('')
      setQuantity(1)
    } else {
      setErrorMsg(result.error || '添加失败')
    }
  }

  const runPrevalidationPipeline = (csvContent: string, batchId: string, schemeId: string) => {
    const pipeline = buildImportValidationPipeline(batchId, csvContent, schemeId || null)
    setPrevalidateResult(pipeline.prevalidateSummary)
    setImportedResult(null)

    if (activeTaskId) {
      updateImportTaskDraft(
        activeTaskId,
        {
          csvContent,
          fileName: pendingFileName,
          selectedBatchId: batchId || null,
          selectedSchemeId: schemeId || null,
          columnMappings: pipeline.columnMappings,
          validationToggles: pipeline.validationToggles,
          prevalidateSummary: pipeline.prevalidateSummary,
          parsedRows: pipeline.parsedRows,
        },
        'prevalidated'
      )
    }

    return pipeline
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      setPendingCSVContent(content)
      setPendingFileName(file.name)

      if (!selectedBatchId) {
        setPrevalidateResult(null)
        setImportedResult(null)
        if (activeTaskId) {
          updateImportTaskDraft(activeTaskId, {
            csvContent: content,
            fileName: file.name,
            selectedSchemeId: selectedSchemeId || null,
          })
        }
        return
      }

      runPrevalidationPipeline(content, selectedBatchId, selectedSchemeId)
    }
    reader.readAsText(file)
  }

  const handleConfirmImport = () => {
    if (!prevalidateResult || !selectedBatchId) return

    const scheme = state.importSchemes.find((s) => s.id === selectedSchemeId)
    const result = batchImportSamples(selectedBatchId, prevalidateResult.results, {
      schemeId: selectedSchemeId || undefined,
      schemeName: scheme?.name,
      validationToggles: scheme?.validationToggles,
      columnMappings: scheme?.columnMappings,
      taskId: activeTaskId || undefined,
    })
    if (result.success && result.importResult) {
      if (activeTaskId) {
        completeImportTask(activeTaskId, result.importResult.id, result.importResult)
        setActiveTaskId(null)
        setLastActiveTask(null)
      }
      setImportedResult({
        successCount: result.importResult.successCount,
        failedCount: result.importResult.failedCount,
      })
      setSuccessMsg(`批量导入完成：成功 ${result.importResult.successCount} 条，失败 ${result.importResult.failedCount} 条`)
    }
  }

  const handleDownloadTemplate = () => {
    const scheme = state.importSchemes.find((s) => s.id === selectedSchemeId)
    let template: string
    if (scheme && scheme.columnMappings.length > 0) {
      const header = scheme.columnMappings.map((m) => m.csvColumn).join(',')
      template = header + '\nSAMPLE-001,5,内科病房\nSAMPLE-002,3,外科病房\nSAMPLE-003,10,检验科'
    } else {
      template = '样本编号,数量,来源\nSAMPLE-001,5,内科病房\nSAMPLE-002,3,外科病房\nSAMPLE-003,10,检验科'
    }
    doExportCSV(template, '批量导入模板.csv')
  }

  const handleSaveToTask = () => {
    const taskNameVal = taskName.trim() || `导入任务_${new Date().toLocaleString('zh-CN')}`
    const scheme = state.importSchemes.find((s) => s.id === selectedSchemeId)
    const pipeline = pendingCSVContent && selectedBatchId
      ? buildImportValidationPipeline(selectedBatchId, pendingCSVContent, selectedSchemeId || null)
      : null
    const task = createImportTask(taskNameVal, {
      csvContent: pendingCSVContent,
      fileName: pendingFileName,
      selectedBatchId: selectedBatchId || null,
      selectedSchemeId: selectedSchemeId || null,
      columnMappings: pipeline?.columnMappings || (scheme ? scheme.columnMappings : null),
      validationToggles: pipeline?.validationToggles || (scheme ? scheme.validationToggles : null),
      prevalidateSummary: pipeline?.prevalidateSummary || prevalidateResult || null,
      parsedRows: pipeline?.parsedRows || null,
    })
    setActiveTaskId(task.id)
    setLastActiveTask(task.id)
    setTaskName('')
    setShowSaveTaskPrompt(false)
    setShowNewTaskPrompt(false)
    setSuccessMsg(`已保存到任务「${task.taskName}」，关闭窗口后可在「导入任务中心」恢复继续`)
    setTimeout(() => setSuccessMsg(''), 4000)
  }

  const handleOpenImportModal = () => {
    const lastTaskId = state.lastActiveTaskId
    const lastTask = lastTaskId ? state.importTasks.find((t) => t.id === lastTaskId) : null
    if (lastTask && (lastTask.status === 'draft' || lastTask.status === 'prevalidated')) {
      setShowResumePrompt(true)
      return
    }
    openImportModalFresh()
  }

  const openImportModalFresh = () => {
    const lastId = state.lastSelectedSchemeId
    const lastChange = state.lastSchemeChange

    let notice: { type: string; message: string } | null = null

    if (lastChange && lastChange.affectedLastSelected) {
      switch (lastChange.type) {
        case 'delete':
          notice = {
            type: 'warning',
            message: `您之前选择的方案「${lastChange.schemeName}」已被删除，已自动切换为默认配置。`,
          }
          break
        case 'rename':
          if (lastChange.oldName) {
            notice = {
              type: 'info',
              message: `您当前选择的方案已重命名：「${lastChange.oldName}」→「${lastChange.schemeName}」`,
            }
          }
          break
        case 'overwrite':
          notice = {
            type: 'warning',
            message: `您当前选择的方案「${lastChange.schemeName}」已被 JSON 导入覆盖，请注意核对列映射、校验开关等配置。`,
          }
          break
        case 'update':
          notice = {
            type: 'info',
            message: `您当前选择的方案「${lastChange.schemeName}」配置已更新。`,
          }
          break
        case 'lock':
          notice = {
            type: 'info',
            message: `您当前选择的方案「${lastChange.schemeName}」已被锁定并共享。`,
          }
          break
        case 'unlock':
          notice = {
            type: 'info',
            message: `您当前选择的方案「${lastChange.schemeName}」已解锁。`,
          }
          break
      }
    }

    if (lastId) {
      const exists = state.importSchemes.find((s) => s.id === lastId)
      if (exists) {
        setSelectedSchemeId(lastId)
        if (!notice) {
          setSchemeChangeNotice(null)
        }
      } else {
        setSelectedSchemeId('')
        if (!notice) {
          notice = {
            type: 'warning',
            message: '之前选择的导入方案已不存在，已切换为默认配置。',
          }
        }
        setLastSelectedScheme(null)
      }
    } else {
      setSelectedSchemeId('')
      if (!notice) {
        setSchemeChangeNotice(null)
      }
    }

    if (notice) {
      setSchemeChangeNotice(notice)
    }

    setPrevalidateResult(null)
    setImportedResult(null)
    setPendingCSVContent(null)
    setPendingFileName(null)
    setActiveTaskId(null)
    setShowImportModal(true)
  }

  const handleResumeActiveTask = () => {
    const lastTaskId = state.lastActiveTaskId
    if (!lastTaskId) {
      openImportModalFresh()
      setShowResumePrompt(false)
      return
    }
    const task = state.importTasks.find((t) => t.id === lastTaskId)
    if (!task) {
      setLastActiveTask(null)
      openImportModalFresh()
      setShowResumePrompt(false)
      return
    }
    const draft = task.draftState
    setActiveTaskId(task.id)
    setSelectedSchemeId(draft.selectedSchemeId || '')
    if (draft.selectedBatchId) {
      setSelectedBatchId(draft.selectedBatchId)
    }
    setPendingCSVContent(draft.csvContent)
    setPendingFileName(draft.fileName)
    if (draft.csvContent && draft.selectedBatchId) {
      setPrevalidateResult(draft.prevalidateSummary)
    } else {
      setPrevalidateResult(null)
    }
    setImportedResult(null)
    setSchemeChangeNotice(null)
    setShowResumePrompt(false)
    setShowImportModal(true)
    setSuccessMsg(`已恢复任务「${task.taskName}」的现场`)
    setTimeout(() => setSuccessMsg(''), 4000)
  }

  const handleDismissResume = () => {
    setLastActiveTask(null)
    setShowResumePrompt(false)
    openImportModalFresh()
  }

  const runPrevalidation = (csvContent: string, batchId: string, schemeId: string) => {
    runPrevalidationPipeline(csvContent, batchId, schemeId)
  }

  const handleQuickCreateBatch = () => {
    const scheme = state.importSchemes.find((s) => s.id === selectedSchemeId)
    if (scheme && scheme.defaultBatch.batchNoPattern) {
      const resolvedBatchNo = resolveDefaultBatch(scheme.defaultBatch.batchNoPattern)
      const resolvedBatchName = resolveDefaultBatch(scheme.defaultBatch.batchNamePattern)
      setImportModalBatchNo(resolvedBatchNo)
      setImportModalBatchName(resolvedBatchName)
    } else {
      setImportModalBatchNo('')
      setImportModalBatchName('')
    }
    setQuickBatchErrorMsg('')
    setShowQuickBatchModal(true)
  }

  const handleConfirmQuickCreateBatch = () => {
    if (!importModalBatchNo.trim()) {
      setQuickBatchErrorMsg('请输入批次编号')
      return
    }
    const exists = state.batches.some((b) => b.batchNo === importModalBatchNo.trim())
    if (exists) {
      setQuickBatchErrorMsg('批次编号已存在')
      return
    }
    const batch = createBatch(importModalBatchNo.trim(), importModalBatchName.trim())
    setSelectedBatchId(batch.id)
    setShowQuickBatchModal(false)
    setImportModalBatchNo('')
    setImportModalBatchName('')
    setQuickBatchErrorMsg('')
    setSuccessMsg(`已创建批次：${batch.batchNo}`)

    if (pendingCSVContent) {
      setTimeout(() => {
        runPrevalidation(pendingCSVContent, batch.id, selectedSchemeId)
      }, 0)
    }

    if (activeTaskId) {
      updateImportTaskDraft(activeTaskId, {
        selectedBatchId: batch.id,
      })
    }
  }

  const handleCloseImportModal = () => {
    const hasUnsaved = (pendingCSVContent || prevalidateResult) && !activeTaskId && !importedResult
    if (hasUnsaved) {
      setShowSaveTaskPrompt(true)
      return
    }
    doCloseImportModal()
  }

  const doCloseImportModal = () => {
    setShowImportModal(false)
    setPrevalidateResult(null)
    setImportedResult(null)
    setSchemeChangeNotice(null)
    clearLastSchemeChange()
    setPendingCSVContent(null)
    setPendingFileName(null)
    setShowSaveTaskPrompt(false)
    setTaskName('')
    if (selectedSchemeId) {
      const exists = state.importSchemes.find((s) => s.id === selectedSchemeId)
      if (exists) {
        setLastSelectedScheme(selectedSchemeId)
      } else {
        setLastSelectedScheme(null)
      }
    } else {
      setLastSelectedScheme(null)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleDiscardAndClose = () => {
    setActiveTaskId(null)
    setLastActiveTask(null)
    doCloseImportModal()
  }

  const handleSchemeChange = (newSchemeId: string) => {
    setSelectedSchemeId(newSchemeId)
    setSchemeChangeNotice(null)
    clearLastSchemeChange()
    if (prevalidateResult) {
      setPrevalidateResult(null)
    }
    if (pendingCSVContent && selectedBatchId) {
      runPrevalidation(pendingCSVContent, selectedBatchId, newSchemeId)
    }
    if (activeTaskId) {
      updateImportTaskDraft(activeTaskId, {
        selectedSchemeId: newSchemeId || null,
      })
    }
  }

  const handleAutoCreateBatch = () => {
    const scheme = state.importSchemes.find((s) => s.id === selectedSchemeId)
    if (!scheme) return
    const resolvedBatchNo = resolveDefaultBatch(scheme.defaultBatch.batchNoPattern)
    const resolvedBatchName = resolveDefaultBatch(scheme.defaultBatch.batchNamePattern)
    const exists = state.batches.some((b) => b.batchNo === resolvedBatchNo)
    if (exists) {
      setErrorMsg(`批次编号 ${resolvedBatchNo} 已存在`)
      return
    }
    if (!resolvedBatchNo) {
      setErrorMsg('方案未设置批次号模式，无法自动创建')
      return
    }
    const batch = createBatch(resolvedBatchNo, resolvedBatchName)
    setSelectedBatchId(batch.id)
    setSuccessMsg(`已按方案自动创建批次：${resolvedBatchNo}`)
  }

  const handleQuickSchemeImport = () => {
    if (!quickSchemeImportJSON.trim()) {
      setQuickSchemeImportResult({ success: false, importedCount: 0, skippedCount: 0, overwrittenCount: 0, error: '请输入或选择 JSON 文件' })
      return
    }
    const result = importSchemesJSON(quickSchemeImportJSON, quickSchemeConflictResolution)
    setQuickSchemeImportResult(result)
    if (result.success) {
      setQuickSchemeImportJSON('')
    }
  }

  const handleExportCurrentScheme = () => {
    const scheme = state.importSchemes.find((s) => s.id === selectedSchemeId)
    if (!scheme) return
    const json = exportSchemesJSON([scheme.id])
    doExportJSON(json, `导入方案_${scheme.name}_${new Date().toISOString().slice(0, 10)}.json`)
    setSuccessMsg(`已导出方案「${scheme.name}」`)
  }

  const handleRevertImport = () => {
    const result = revertLastImport(revertReason.trim() || undefined)
    if (result.success) {
      setSuccessMsg(`撤销成功！已回滚 ${result.revertedCount} 条样本`)
      setShowRevertConfirm(false)
      setRevertReason('')
      setTimeout(() => setSuccessMsg(''), 5000)
    } else {
      setErrorMsg(result.error || '撤销失败')
    }
  }

  const selectedScheme = state.importSchemes.find((s) => s.id === selectedSchemeId)

  const selectedBatch = state.batches.find((b) => b.id === selectedBatchId)
  const batchSamples = state.samples.filter((s) => s.batchId === selectedBatchId)

  const activeTask = activeTaskId
    ? state.importTasks.find((t) => t.id === activeTaskId)
    : null

  const lastActiveTaskObj = state.lastActiveTaskId
    ? state.importTasks.find((t) => t.id === state.lastActiveTaskId)
    : null

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">样本接收</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {canRevertLastImport() && (
            <button
              className="btn btn-warning"
              onClick={() => setShowRevertConfirm(true)}
              title="撤销最近一次批量导入"
            >
              ↩️ 撤销最近导入
            </button>
          )}
          <button
            className="btn btn-success"
            onClick={handleOpenImportModal}
          >
            📥 CSV 批量导入
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowBatchModal(true)}
          >
            + 新建批次
          </button>
        </div>
      </div>

      {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      <div style={{ marginBottom: 16, padding: 12, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4 }}>
        <span style={{ fontSize: 14, color: '#d48806' }}>
          💡 <strong>提示：</strong>批量导入后，可在左侧菜单「🎯 导入任务中心」中管理所有导入任务（草稿可恢复、可审计），或在「📋 导入历史」查看所有导入记录。关闭应用重启后任务草稿和预检结果完整保留。
        </span>
      </div>

      {activeTask && (
        <div style={{
          marginBottom: 16,
          padding: '12px 16px',
          background: '#ecf5ff',
          border: '1px solid #b3d8ff',
          borderRadius: 4,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <span style={{ fontWeight: 600, color: '#409eff' }}>🎯 关联任务：</span>
            <span style={{ color: '#303133' }}>{activeTask.taskName}</span>
            <span style={{
              marginLeft: 8,
              padding: '2px 8px',
              background: '#ecf5ff',
              border: '1px solid #b3d8ff',
              borderRadius: 3,
              fontSize: 12,
              color: '#409eff',
            }}>
              {activeTask.status === 'draft' ? '草稿' : activeTask.status === 'prevalidated' ? '已预检' : activeTask.status}
            </span>
            <span style={{ marginLeft: 12, fontSize: 12, color: '#909399' }}>
              (配置修改、预检、导入结果均会自动同步到任务)
            </span>
          </div>
          <button
            className="btn btn-default btn-sm"
            onClick={() => {
              setActiveTaskId(null)
              setLastActiveTask(null)
              setSuccessMsg('已解除任务关联')
              setTimeout(() => setSuccessMsg(''), 3000)
            }}
          >
            解除关联
          </button>
        </div>
      )}

      <div className="card">
        <div className="form-group">
          <label className="form-label">选择批次</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="form-input"
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">-- 请选择批次 --</option>
              {state.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNo} - {b.name || '未命名'}
                </option>
              ))}
            </select>
            {selectedScheme && selectedScheme.defaultBatch.batchNoPattern && !selectedBatchId && (
              <button className="btn btn-default btn-sm" onClick={handleAutoCreateBatch}>
                按方案创建批次
              </button>
            )}
          </div>
        </div>

        {selectedBatch && (
          <div style={{ padding: '12px', background: '#f0f7ff', borderRadius: 4, marginBottom: 16 }}>
            <p><strong>批次号：</strong>{selectedBatch.batchNo}</p>
            <p><strong>批次名称：</strong>{selectedBatch.name || '未命名'}</p>
            <p><strong>创建人：</strong>{selectedBatch.createdBy}</p>
            <p><strong>创建时间：</strong>{new Date(selectedBatch.createdAt).toLocaleString('zh-CN')}</p>
            <p><strong>该批次样本数：</strong>{batchSamples.length}</p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">样本唯一编号 *</label>
            <input
              type="text"
              className="form-input"
              value={sampleNo}
              onChange={(e) => setSampleNo(e.target.value)}
              placeholder="请输入样本编号"
            />
          </div>
          <div className="form-group">
            <label className="form-label">数量 *</label>
            <input
              type="number"
              className="form-input"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              min={1}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">样本来源 *</label>
          <input
            type="text"
            className="form-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="例如：检验科、内科病房、外部送检等"
          />
        </div>

        <button
          className="btn btn-primary"
          onClick={handleAddSample}
          style={{ width: '100%', padding: 12, fontSize: 16 }}
        >
          确认接收
        </button>
      </div>

      {selectedBatchId && batchSamples.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>本批次已接收样本</h3>
          <table className="table">
            <thead>
              <tr>
                <th>样本编号</th>
                <th>数量</th>
                <th>来源</th>
                <th>状态</th>
                <th>接收时间</th>
              </tr>
            </thead>
            <tbody>
              {batchSamples.map((s) => (
                <tr key={s.id}>
                  <td>{s.sampleNo}</td>
                  <td>{s.quantity}</td>
                  <td>{s.source}</td>
                  <td>
                    <span
                      className="status-tag"
                      style={{ background: STATUS_COLORS[s.status] }}
                    >
                      {STATUS_LABELS[s.status]}
                    </span>
                  </td>
                  <td>{new Date(s.receivedAt).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showBatchModal && (
        <div className="modal-overlay" onClick={() => setShowBatchModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">新建批次</div>
              <div className="modal-close" onClick={() => setShowBatchModal(false)}>×</div>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">批次编号 *</label>
                <input
                  type="text"
                  className="form-input"
                  value={batchNo}
                  onChange={(e) => setBatchNo(e.target.value)}
                  placeholder="例如：BATCH-20240616-001"
                />
              </div>
              <div className="form-group">
                <label className="form-label">批次名称</label>
                <input
                  type="text"
                  className="form-input"
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder="例如：6月16日第一批送检"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => setShowBatchModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleCreateBatch}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {showResumePrompt && lastActiveTaskObj && (
        <div className="modal-overlay" onClick={handleDismissResume}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
            <div className="modal-header">
              <div className="modal-title">检测到未完成的导入任务</div>
              <div className="modal-close" onClick={handleDismissResume}>×</div>
            </div>
            <div className="modal-body">
              <div style={{
                padding: 16,
                background: '#ecf5ff',
                border: '1px solid #b3d8ff',
                borderRadius: 4,
                marginBottom: 12,
              }}>
                <div style={{ marginBottom: 6 }}>
                  <strong>任务名称：</strong>{lastActiveTaskObj.taskName}
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong>当前状态：</strong>
                  <span style={{
                    padding: '2px 8px',
                    background: '#ecf5ff',
                    color: '#409eff',
                    borderRadius: 3,
                    fontSize: 12,
                  }}>
                    {lastActiveTaskObj.status === 'draft' ? '草稿中' : lastActiveTaskObj.status === 'prevalidated' ? '已预检' : lastActiveTaskObj.status}
                  </span>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong>批次：</strong>{lastActiveTaskObj.batchNo || (lastActiveTaskObj.batchId ? state.batches.find((b) => b.id === lastActiveTaskObj.batchId)?.batchNo : '未选择') || '未选择'}
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong>方案：</strong>{lastActiveTaskObj.schemeName || '无'}
                </div>
                {lastActiveTaskObj.draftState.fileName && (
                  <div style={{ marginBottom: 6 }}>
                    <strong>CSV 文件：</strong>{lastActiveTaskObj.draftState.fileName}
                  </div>
                )}
                {lastActiveTaskObj.draftState.prevalidateSummary && (
                  <div>
                    <strong>预检结果：</strong>
                    共{lastActiveTaskObj.draftState.prevalidateSummary.total}条，
                    有效{lastActiveTaskObj.draftState.prevalidateSummary.validCount}条，
                    无效{lastActiveTaskObj.draftState.prevalidateSummary.invalidCount}条
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 12, color: '#909399' }}>
                  创建人：{lastActiveTaskObj.createdBy} · 更新时间：{new Date(lastActiveTaskObj.updatedAt).toLocaleString('zh-CN')}
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#606266' }}>
                选择「恢复继续」将自动载入以上所有现场配置（CSV文件、映射、预检结果等），直接回到离开时的流程继续操作。
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={handleDismissResume}>
                开始新导入
              </button>
              <button className="btn btn-primary" onClick={handleResumeActiveTask}>
                ▶ 恢复继续
              </button>
            </div>
          </div>
        </div>
      )}

      {showSaveTaskPrompt && !activeTaskId && (
        <div className="modal-overlay" onClick={() => setShowSaveTaskPrompt(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">保存为任务草稿？</div>
              <div className="modal-close" onClick={() => setShowSaveTaskPrompt(false)}>×</div>
            </div>
            <div className="modal-body">
              <div style={{
                padding: 12,
                background: '#fff7e6',
                border: '1px solid #ffd591',
                borderRadius: 4,
                marginBottom: 12,
                fontSize: 13,
                color: '#d46b08',
              }}>
                ⚠️ 检测到您有未保存的配置：
                {pendingCSVContent && <> 已选择CSV文件「{pendingFileName}」</>}
                {prevalidateResult && <>、预检结果已生成</>}
                ，是否保存为任务草稿？
                <div style={{ marginTop: 4, fontSize: 12, color: '#873800' }}>
                  保存后可在「导入任务中心」跨重启恢复，继续后续操作。
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">任务名称（可选）</label>
                <input
                  type="text"
                  className="form-input"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder={`留空则自动生成：导入任务_${new Date().toLocaleString('zh-CN')}`}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={handleDiscardAndClose}>
                不保存，直接关闭
              </button>
              <button className="btn btn-primary" onClick={handleSaveToTask}>
                💾 保存并关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showRevertConfirm && (
        <div className="modal-overlay" onClick={() => { setShowRevertConfirm(false); setRevertReason('') }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">撤销最近一次导入</div>
              <div className="modal-close" onClick={() => { setShowRevertConfirm(false); setRevertReason('') }}>×</div>
            </div>
            <div className="modal-body">
              <div style={{
                padding: 12,
                background: '#fff1f0',
                border: '1px solid #ffa39e',
                borderRadius: 4,
                marginBottom: 12,
                fontSize: 13,
                color: '#cf1322',
              }}>
                ⚠️ 此操作将永久删除最近一次批量导入成功的所有样本及其台账记录，此操作不可恢复。
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
              <button className="btn btn-default" onClick={() => { setShowRevertConfirm(false); setRevertReason('') }}>
                取消
              </button>
              <button className="btn btn-danger" onClick={handleRevertImport}>
                确认撤销（不可恢复）
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={handleCloseImportModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 700, maxWidth: '90vw' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="modal-title" style={{ margin: 0 }}>CSV 批量导入样本</div>
                {activeTask && (
                  <span style={{
                    padding: '2px 10px',
                    background: '#ecf5ff',
                    border: '1px solid #b3d8ff',
                    borderRadius: 3,
                    fontSize: 12,
                    color: '#409eff',
                  }}>
                    🎯 {activeTask.taskName}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!activeTaskId && !importedResult && (
                  <button
                    className="btn btn-default btn-sm"
                    onClick={() => setShowSaveTaskPrompt(true)}
                    title="保存当前配置为任务草稿（可跨重启恢复）"
                  >
                    💾 存为任务
                  </button>
                )}
                <div className="modal-close" onClick={handleCloseImportModal}>×</div>
              </div>
            </div>
            <div className="modal-body">
              {!prevalidateResult ? (
                <div>
                  {schemeChangeNotice && (
                    <div style={{
                      padding: '10px 14px',
                      background: schemeChangeNotice.type === 'warning' ? '#fff2f0' : '#e6f7ff',
                      border: `1px solid ${schemeChangeNotice.type === 'warning' ? '#ffa39e' : '#91d5ff'}`,
                      borderRadius: 4,
                      marginBottom: 12,
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}>
                      <span>{schemeChangeNotice.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                      <span style={{ flex: 1 }}>{schemeChangeNotice.message}</span>
                      <button
                        onClick={() => setSchemeChangeNotice(null)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#999',
                          fontSize: 16,
                          padding: 0,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )}

                  {!selectedBatchId && (
                    <div style={{
                      padding: '12px 14px',
                      background: '#fff7e6',
                      border: '1px solid #ffd591',
                      borderRadius: 4,
                      marginBottom: 16,
                      fontSize: 13,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                        <span>⚠️</span>
                        <span style={{ flex: 1 }}><strong>尚未选择接收批次</strong>，请先选择或创建批次后再导入。</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {selectedScheme && selectedScheme.defaultBatch.batchNoPattern && (
                          <button className="btn btn-primary btn-sm" onClick={handleQuickCreateBatch}>
                            📋 按方案创建批次
                          </button>
                        )}
                        <button className="btn btn-default btn-sm" onClick={handleQuickCreateBatch}>
                          + 手动创建批次
                        </button>
                      </div>
                      {pendingFileName && (
                        <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
                          ✓ 已选择文件：{pendingFileName}（创建批次后将自动预检，<strong>现场状态完整保留</strong>）
                        </div>
                      )}
                    </div>
                  )}

                  {selectedBatchId && (
                    <div style={{
                      padding: '10px 14px',
                      background: '#f6ffed',
                      border: '1px solid #b7eb8f',
                      borderRadius: 4,
                      marginBottom: 12,
                      fontSize: 13,
                    }}>
                      <span>✓ 已选择批次：<strong>{state.batches.find(b => b.id === selectedBatchId)?.batchNo}</strong></span>
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label">套用导入方案</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select
                        className="form-input"
                        value={selectedSchemeId}
                        onChange={(e) => handleSchemeChange(e.target.value)}
                        style={{ flex: 1 }}
                      >
                        <option value="">不使用方案（默认配置）</option>
                        {state.importSchemes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}{s.isShared ? ' [共享]' : ''}{s.isLocked ? ' [锁定]' : ''}
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-default btn-sm" onClick={() => setShowQuickSchemeImportModal(true)} title="快速导入方案 JSON">
                        📥
                      </button>
                      {selectedScheme && (
                        <button className="btn btn-default btn-sm" onClick={handleExportCurrentScheme} title="导出当前方案 JSON">
                          📤
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedScheme && (
                    <div style={{ padding: 10, background: '#f0f7ff', borderRadius: 4, marginBottom: 16, fontSize: 13 }}>
                      <div><strong>方案：</strong>{selectedScheme.name}</div>
                      <div><strong>列映射：</strong>{selectedScheme.columnMappings.map((m) => `${m.csvColumn}→${m.targetField}`).join('、')}</div>
                      <div><strong>批次号模式：</strong>{selectedScheme.defaultBatch.batchNoPattern || '未设置'}</div>
                      <div><strong>已启用校验（拦截）：</strong>{
                        Object.entries(selectedScheme.validationToggles)
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
                          .join('、') || '无（全部跳过）'
                      }</div>
                      <div><strong>已关闭校验（跳过）：</strong>{
                        Object.entries(selectedScheme.validationToggles)
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
                          .join('、') || '无（严格校验）'
                      }</div>
                    </div>
                  )}
                  <p style={{ marginBottom: 16 }}>
                    请选择 CSV 文件{selectedScheme ? `，表头需包含：${selectedScheme.columnMappings.map((m) => m.csvColumn).join('、')}` : '，格式：样本编号,数量,来源'}
                  </p>
                  <div style={{ marginBottom: 16 }}>
                    <button className="btn btn-default" onClick={handleDownloadTemplate}>
                      📄 下载导入模板
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                    className="form-input"
                  />
                </div>
              ) : (
                <div>
                  <div style={{
                    padding: 12,
                    borderRadius: 4,
                    marginBottom: 16,
                    background: prevalidateResult.canImport ? '#f6ffed' : '#fff2f0',
                    border: `1px solid ${prevalidateResult.canImport ? '#b7eb8f' : '#ffa39e'}`,
                  }}>
                    <p style={{ margin: '4px 0' }}>
                      共 <strong>{prevalidateResult.total}</strong> 条记录，
                      <span style={{ color: '#52c41a' }}> 有效 {prevalidateResult.validCount} 条</span>，
                      <span style={{ color: '#f5222d' }}> 无效 {prevalidateResult.invalidCount} 条</span>
                    </p>
                    {!prevalidateResult.canImport && (
                      <p style={{ margin: '4px 0', color: '#f5222d' }}>
                        没有可导入的有效记录，请修正 CSV 文件后重新选择
                      </p>
                    )}
                  </div>

                  <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e8e8e8', borderRadius: 4 }}>
                    <table className="table" style={{ margin: 0 }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#fafafa' }}>
                        <tr>
                          <th style={{ width: 60 }}>行号</th>
                          <th>样本编号</th>
                          <th style={{ width: 60 }}>数量</th>
                          <th>来源</th>
                          <th style={{ width: 80 }}>状态</th>
                          <th>说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prevalidateResult.results.map((r) => (
                          <tr key={r.rowIndex} style={{
                            background: r.valid ? 'transparent' : '#fff2f0',
                          }}>
                            <td>{r.rowIndex}</td>
                            <td>{r.sampleNo || '-'}</td>
                            <td>{r.quantity || '-'}</td>
                            <td>{r.source || '-'}</td>
                            <td>
                              <span className="status-tag" style={{
                                background: r.valid ? '#52c41a' : '#f5222d',
                              }}>
                                {r.valid ? '通过' : '失败'}
                              </span>
                            </td>
                            <td style={{ color: '#f5222d', fontSize: 12 }}>
                              {r.errors.join('；')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {importedResult && (
                    <div style={{
                      marginTop: 16,
                      padding: 12,
                      background: '#f6ffed',
                      border: '1px solid #b7eb8f',
                      borderRadius: 4,
                    }}>
                      <strong>✅ 导入完成！</strong> 成功 {importedResult.successCount} 条，失败 {importedResult.failedCount} 条
                      {activeTaskId && <>（结果已同步到任务中心）</>}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={handleCloseImportModal}>
                {importedResult ? '完成' : '取消'}
              </button>
              {prevalidateResult && prevalidateResult.canImport && !importedResult && (
                <button className="btn btn-primary" onClick={handleConfirmImport}>
                  确认导入 {prevalidateResult.validCount} 条
                </button>
              )}
              {prevalidateResult && !importedResult && (
                <button className="btn btn-default" onClick={() => {
                  setPrevalidateResult(null)
                  if (fileInputRef.current) {
                    fileInputRef.current.value = ''
                  }
                  if (activeTaskId) {
                    updateImportTaskDraft(activeTaskId, {
                      prevalidateSummary: null,
                      parsedRows: null,
                    }, 'draft')
                  }
                }}>
                  重新选择文件
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showQuickBatchModal && (
        <div className="modal-overlay-top" onClick={() => {
          setShowQuickBatchModal(false)
          setQuickBatchErrorMsg('')
          setImportModalBatchNo('')
          setImportModalBatchName('')
        }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">创建接收批次</div>
              <div className="modal-close" onClick={() => {
                setShowQuickBatchModal(false)
                setQuickBatchErrorMsg('')
                setImportModalBatchNo('')
                setImportModalBatchName('')
              }}>×</div>
            </div>
            <div className="modal-body">
              {quickBatchErrorMsg && <div className="alert alert-error">{quickBatchErrorMsg}</div>}
              <div className="form-group">
                <label className="form-label">批次编号 *</label>
                <input
                  type="text"
                  className="form-input"
                  value={importModalBatchNo}
                  onChange={(e) => setImportModalBatchNo(e.target.value)}
                  placeholder="例如：BATCH-20240616-001"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">批次名称</label>
                <input
                  type="text"
                  className="form-input"
                  value={importModalBatchName}
                  onChange={(e) => setImportModalBatchName(e.target.value)}
                  placeholder="例如：6月16日第一批送检"
                />
              </div>
              {pendingFileName && (
                <div style={{ padding: '10px', background: '#f0f7ff', borderRadius: 4, fontSize: 13 }}>
                  ✓ 创建后将自动对已选文件「{pendingFileName}」进行预检，<strong>现场配置不丢失</strong>
                </div>
              )}
              {selectedScheme && (
                <div style={{ padding: '10px', background: '#f0f7ff', borderRadius: 4, fontSize: 13, marginTop: 8 }}>
                  ✓ 将套用方案「{selectedScheme.name}」的校验开关和列映射
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => {
                setShowQuickBatchModal(false)
                setQuickBatchErrorMsg('')
                setImportModalBatchNo('')
                setImportModalBatchName('')
              }}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleConfirmQuickCreateBatch}>
                创建并继续导入
              </button>
            </div>
          </div>
        </div>
      )}

      {showQuickSchemeImportModal && (
        <div className="modal-overlay-top" onClick={() => {
          setShowQuickSchemeImportModal(false)
          setQuickSchemeImportJSON('')
          setQuickSchemeImportResult(null)
          setQuickSchemeConflictResolution('skip')
        }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 600, maxWidth: '90vw' }}>
            <div className="modal-header">
              <div className="modal-title">快速导入方案 JSON</div>
              <div className="modal-close" onClick={() => {
                setShowQuickSchemeImportModal(false)
                setQuickSchemeImportJSON('')
                setQuickSchemeImportResult(null)
                setQuickSchemeConflictResolution('skip')
              }}>×</div>
            </div>
            <div className="modal-body">
              {!quickSchemeImportResult ? (
                <>
                  <div className="form-group">
                    <label className="form-label">选择 JSON 文件</label>
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = (event) => {
                          const content = event.target?.result as string
                          setQuickSchemeImportJSON(content)
                        }
                        reader.readAsText(file)
                      }}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">或粘贴 JSON 内容</label>
                    <textarea
                      className="form-textarea"
                      value={quickSchemeImportJSON}
                      onChange={(e) => setQuickSchemeImportJSON(e.target.value)}
                      rows={4}
                      placeholder='{"version":1,"schemes":[...]}'
                    />
                  </div>
                  {quickSchemeImportJSON.trim() && (() => {
                    try {
                      const data = JSON.parse(quickSchemeImportJSON)
                      if (!data.schemes || !Array.isArray(data.schemes)) return null
                      const conflicts = data.schemes.filter((s: any) =>
                        state.importSchemes.some((es) => es.name === s.name)
                      )
                      if (conflicts.length === 0) return null
                      return (
                        <div style={{
                          padding: '10px 14px',
                          background: '#fff7e6',
                          border: '1px solid #ffd591',
                          borderRadius: 4,
                          marginBottom: 12,
                          fontSize: 13,
                        }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#d46b08' }}>
                            ⚠️ 检测到 {conflicts.length} 个同名冲突
                          </div>
                          {conflicts.map((c: any, idx: number) => (
                            <div key={idx} style={{ padding: '2px 0' }}>• 「{c.name}」</div>
                          ))}
                        </div>
                      )
                    } catch {
                      return null
                    }
                  })()}
                  <div className="form-group">
                    <label className="form-label">同名冲突处理</label>
                    <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="quick-conflict"
                          checked={quickSchemeConflictResolution === 'skip'}
                          onChange={() => setQuickSchemeConflictResolution('skip')}
                        />
                        跳过（保留现有方案）
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="quick-conflict"
                          checked={quickSchemeConflictResolution === 'overwrite'}
                          onChange={() => setQuickSchemeConflictResolution('overwrite')}
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
                  background: quickSchemeImportResult.success ? '#f6ffed' : '#fff2f0',
                  border: `1px solid ${quickSchemeImportResult.success ? '#b7eb8f' : '#ffa39e'}`,
                }}>
                  {quickSchemeImportResult.success ? (
                    <>
                      <strong>✅ 导入完成</strong>
                      <div style={{ marginTop: 8, fontSize: 14 }}>
                        <div>新增：<strong>{quickSchemeImportResult.importedCount}</strong> 个</div>
                        <div>覆盖：<strong>{quickSchemeImportResult.overwrittenCount}</strong> 个</div>
                        <div>跳过：<strong>{quickSchemeImportResult.skippedCount}</strong> 个</div>
                      </div>
                    </>
                  ) : (
                    <strong>❌ 导入失败：{quickSchemeImportResult.error}</strong>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-default" onClick={() => {
                setShowQuickSchemeImportModal(false)
                setQuickSchemeImportJSON('')
                setQuickSchemeImportResult(null)
                setQuickSchemeConflictResolution('skip')
              }}>
                {quickSchemeImportResult ? '完成' : '取消'}
              </button>
              {!quickSchemeImportResult && (
                <button className="btn btn-primary" onClick={handleQuickSchemeImport}>确认导入</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SampleReceive
