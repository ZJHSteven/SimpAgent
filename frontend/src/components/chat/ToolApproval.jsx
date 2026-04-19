import React from 'react'

export function ToolApproval({ toolName, onAllow, onReject }) {
  return (
    <div className="my-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 flex flex-col gap-3 w-fit">
      <div className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 font-medium">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          <polyline points="7.5 4.21 12 6.81 16.5 4.21"></polyline>
          <polyline points="7.5 19.79 7.5 14.6 3 12"></polyline>
          <polyline points="21 12 16.5 14.6 16.5 19.79"></polyline>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
          <line x1="12" y1="22.08" x2="12" y2="12"></line>
        </svg>
        SimpChat 请求使用工具：<span className="font-mono bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded">{toolName}</span>
      </div>
      <div className="flex gap-2">
        <button 
          onClick={onReject}
          className="px-3 py-1.5 text-sm bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-md transition dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          拒绝
        </button>
        <button 
          onClick={onAllow}
          className="px-3 py-1.5 text-sm bg-black text-white hover:bg-gray-800 rounded-md transition dark:bg-white dark:text-black dark:hover:bg-gray-200 flex items-center gap-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          允许
        </button>
      </div>
    </div>
  )
}
