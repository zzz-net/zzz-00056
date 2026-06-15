import React, { createContext, useContext, useReducer, useEffect, ReactNode, useState, useRef } from 'react'
import { AppData, Sample, Batch, HistoryRecord, SampleStatus, User } from '../types'
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
  | { type: 'UNDO_LAST_STATUS'; sampleId: string }

const defaultData: AppData = {
  users: [
    { id: 'user-1', username: '操作员小王', role: 'operator' },
    { id: 'user-2', username: '复核员老李', role: 'reviewer' },
  ],
  batches: [],
  samples: [],
  currentUserId: 'user-1',
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
          if (s.id !== action.sampleId || s.history.length < 2) return s
          const newHistory = s.history.slice(0, -1)
          const prevStatus = newHistory[newHistory.length - 1].toStatus as SampleStatus
          return { ...s, status: prevStatus, history: newHistory }
        }),
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
  exportHandoverCSV: (batchId?: string) => string
  doExportCSV: (content: string, fileName: string) => Promise<boolean>
  isElectron: boolean
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const isLoadedRef = useRef(false)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (isLoadedRef.current) {
      persistData(state)
    }
  }, [state])

  const loadData = async () => {
    try {
      if (isElectron) {
        const data = await (window as any).electronAPI.getData()
        dispatch({ type: 'SET_DATA', payload: data })
      } else {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
          const data = JSON.parse(stored)
          dispatch({ type: 'SET_DATA', payload: data })
        } else {
          dispatch({ type: 'SET_DATA', payload: defaultData })
        }
      }
    } catch (e) {
      console.error('加载数据失败', e)
      dispatch({ type: 'SET_DATA', payload: defaultData })
    } finally {
      setTimeout(() => {
        isLoadedRef.current = true
      }, 0)
    }
  }

  const persistData = async (data: AppData) => {
    try {
      if (isElectron) {
        await (window as any).electronAPI.saveData(data)
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      }
    } catch (e) {
      console.error('保存数据失败', e)
    }
  }

  const doExportCSV = async (content: string, fileName: string): Promise<boolean> => {
    try {
      if (isElectron) {
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
    return { success: true, sample }
  }

  const canReview = (): boolean => {
    const user = getCurrentUser()
    return user?.role === 'reviewer'
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

    dispatch({ type: 'UPDATE_SAMPLE', payload: updatedSample })
    return { success: true }
  }

  const undoLastStatus = (sampleId: string): { success: boolean; error?: string } => {
    const sample = state.samples.find((s) => s.id === sampleId)
    if (!sample) return { success: false, error: '样本不存在' }
    if (sample.history.length < 2) {
      return { success: false, error: '该样本尚无状态变更记录，无法撤销' }
    }
    if (sample.status === 'returned') {
      dispatch({ type: 'UNDO_LAST_STATUS', sampleId })
      return { success: true }
    }
    return { success: false, error: '仅退回状态可撤销最近一次变更' }
  }

  const exportHandoverCSV = (batchId?: string): string => {
    const samples = batchId
      ? state.samples.filter((s) => s.batchId === batchId && s.status === 'reviewed')
      : state.samples.filter((s) => s.status === 'reviewed')

    const headers = ['样本编号', '所属批次', '数量', '来源', '接收时间', '接收人', '状态']
    const rows = samples.map((s) => {
      const batch = state.batches.find((b) => b.id === s.batchId)
      return [
        s.sampleNo,
        batch?.batchNo || '',
        s.quantity.toString(),
        s.source,
        new Date(s.receivedAt).toLocaleString('zh-CN'),
        s.receivedBy,
        '已复核通过',
      ]
    })

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    return csvContent
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
        exportHandoverCSV,
        doExportCSV,
        isElectron,
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
