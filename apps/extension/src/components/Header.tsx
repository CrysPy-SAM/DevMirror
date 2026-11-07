import React from 'react';
import { Smartphone, RefreshCw, Settings } from 'lucide-react';

interface HeaderProps {
  isConnected: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isConnected,
  isRefreshing,
  onRefresh,
  onOpenSettings
}) => {
  return (
    <header className="flex items-center justify-between px-4 py-3 bg-slate-800/80 backdrop-blur border-b border-slate-700/60 sticky top-0 z-20">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-500/20">
          <Smartphone className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
            DevMirror
            <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              v0.1
            </span>
          </h1>
          <div className="flex items-center gap-1 text-[11px]">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isConnected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-rose-400'
              }`}
            />
            <span className={isConnected ? 'text-emerald-400 font-medium' : 'text-rose-400'}>
              {isConnected ? 'Agent Online' : 'Agent Offline'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh status"
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded-md transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
        </button>
        <button
          onClick={onOpenSettings}
          title="Settings"
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded-md transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
