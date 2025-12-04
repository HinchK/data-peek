import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface AppSettings {
  // Query editor settings
  hideQueryEditorByDefault: boolean
  // JSON display settings
  expandJsonByDefault: boolean
  hideQuickQueryPanel: boolean
  jsonExpandDepth: number
}

interface SettingsState extends AppSettings {
  // Actions
  setHideQueryEditorByDefault: (value: boolean) => void
  setExpandJsonByDefault: (value: boolean) => void
  setJsonExpandDepth: (depth: number) => void
  resetSettings: () => void
  setHideQuickQueryPanel: (value: boolean) => void
}

const defaultSettings: AppSettings = {
  hideQueryEditorByDefault: false,
  expandJsonByDefault: false,
  jsonExpandDepth: 2,
  hideQuickQueryPanel: true
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      setHideQueryEditorByDefault: (value) => set({ hideQueryEditorByDefault: value }),
      setExpandJsonByDefault: (value) => set({ expandJsonByDefault: value }),
      setJsonExpandDepth: (depth) => set({ jsonExpandDepth: depth }),
      setHideQuickQueryPanel: (value) => set({ hideQuickQueryPanel: value }),
      resetSettings: () => set(defaultSettings)
    }),
    {
      name: 'data-peek-settings',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
