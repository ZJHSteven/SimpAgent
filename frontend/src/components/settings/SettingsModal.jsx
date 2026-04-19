import React from 'react'

export function SettingsModal({ onClose }) {
  // TODO: Add more settings as needed
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-750">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">设置</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 text-gray-700 dark:text-gray-300 space-y-6">
          {/* General Settings */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider mb-4 border-b pb-2">
              通用设置
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label htmlFor="theme" className="font-medium text-sm">主题偏好</label>
                <select id="theme" className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-32 p-2 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500">
                  <option value="system">跟随系统</option>
                  <option value="light">浅色模式</option>
                  <option value="dark">深色模式</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label htmlFor="lang" className="font-medium text-sm">语言 / Locale</label>
                <select id="lang" className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-32 p-2 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500">
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-gray-750 flex justify-end">
          <button 
            type="button" 
            onClick={onClose}
            className="px-4 py-2 bg-black text-white hover:bg-gray-800 rounded-lg text-sm font-medium transition dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
