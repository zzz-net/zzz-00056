export interface ElectronAPI {
  getData: () => Promise<any>
  saveData: (data: any) => Promise<boolean>
  exportCSV: (content: string, defaultName: string) => Promise<boolean>
  exportJSON: (content: string, defaultName: string) => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
