import React, { useState } from 'react';
import { Play, Square, Plus, Radio } from 'lucide-react';
import type { DiscoveredDevServer, SanitizedSessionInfo, TargetDevServer } from '../types.js';

interface ControlsProps {
  session: SanitizedSessionInfo | null;
  discoveredServers: DiscoveredDevServer[];
  isConnected: boolean;
  isLoading: boolean;
  onStart: (target: Partial<TargetDevServer> & { port: number }) => void;
  onStop: () => void;
}

export const Controls: React.FC<ControlsProps> = ({
  session,
  discoveredServers,
  isConnected,
  isLoading,
  onStart,
  onStop
}) => {
  const [customPort, setCustomPort] = useState<string>('');
  const [showCustomInput, setShowCustomInput] = useState<boolean>(false);
  const hasActiveSession = session !== null;

  const handleStartCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = Number(customPort.trim());
    if (portNum >= 1024 && portNum <= 65535) {
      onStart({
        port: portNum,
        host: '127.0.0.1',
        framework: 'unknown',
        frameworkName: `Custom (: ${portNum})`
      });
      setCustomPort('');
      setShowCustomInput(false);
    }
  };

  if (!isConnected) {
    return null;
  }

  if (hasActiveSession) {
    return (
      <div className="pt-1">
        <button
          onClick={onStop}
          disabled={isLoading}
          className="w-full py-2 px-3 bg-rose-600/90 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm shadow-rose-900/30 transition-all disabled:opacity-50"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
          <span>Stop Preview Session</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
          <Radio className="w-3 h-3 text-indigo-400" /> Discovered Projects
        </span>
        <button
          onClick={() => setShowCustomInput(!showCustomInput)}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
        >
          <Plus className="w-3 h-3" />
          <span>{showCustomInput ? 'Cancel' : 'Custom Port'}</span>
        </button>
      </div>

      {showCustomInput ? (
        <form onSubmit={handleStartCustom} className="flex gap-1.5 bg-slate-800/80 p-2 rounded-lg border border-slate-700/60">
          <input
            type="number"
            min={1024}
            max={65535}
            required
            placeholder="Port (e.g. 5173)"
            value={customPort}
            onChange={(e) => setCustomPort(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-indigo-500 font-mono"
          />
          <button
            type="submit"
            disabled={isLoading || !customPort}
            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium flex items-center gap-1 disabled:opacity-50"
          >
            <Play className="w-3 h-3 fill-current" /> Start
          </button>
        </form>
      ) : null}

      {discoveredServers.length > 0 ? (
        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
          {discoveredServers.map((s) => (
            <div
              key={s.port}
              className="flex items-center justify-between p-2 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 rounded-lg transition-colors"
            >
              <div className="min-w-0 pr-2">
                <p className="text-xs font-semibold text-white truncate">
                  {s.frameworkName || s.framework}
                  <span className="text-slate-400 font-normal ml-1">(:{s.port})</span>
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  {s.processName ? `${s.processName} • ` : ''}{s.confidence} confidence
                </p>
              </div>
              <button
                onClick={() =>
                  onStart({
                    port: s.port,
                    host: s.host,
                    framework: s.framework,
                    frameworkName: s.frameworkName,
                    isHttps: s.isHttps
                  })
                }
                disabled={isLoading}
                className="px-2.5 py-1 bg-indigo-600/90 hover:bg-indigo-500 text-white rounded text-[11px] font-medium flex items-center gap-1 shrink-0 transition-colors disabled:opacity-50"
              >
                <Play className="w-2.5 h-2.5 fill-current" /> Preview
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-3 bg-slate-800/30 rounded-lg text-center border border-slate-800">
          <p className="text-[11px] text-slate-400">No active local dev servers auto-detected.</p>
          <button
            onClick={() => setShowCustomInput(true)}
            className="text-[11px] text-indigo-400 hover:underline mt-0.5 font-medium"
          >
            Enter your dev server port manually
          </button>
        </div>
      )}
    </div>
  );
};
