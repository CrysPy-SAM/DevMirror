import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import type { ControlApiConfig } from '../types.js';

interface SettingsModalProps {
  isOpen: boolean;
  config: ControlApiConfig;
  onClose: () => void;
  onSave: (newConfig: Partial<ControlApiConfig>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  config,
  onClose,
  onSave
}) => {
  const [host, setHost] = useState<string>(config.host);
  const [port, setPort] = useState<string>(String(config.port));
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const portNum = Number(port.trim());

    if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
      setError('Port must be an integer between 1024 and 65535.');
      return;
    }

    const cleanHost = host.trim().toLowerCase();
    if (cleanHost !== '127.0.0.1' && cleanHost !== 'localhost') {
      setError('Security policy requires Control API to be on 127.0.0.1 or localhost.');
      return;
    }

    setError(null);
    onSave({ host: cleanHost, port: portNum });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-xs p-4 shadow-xl text-left space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
          <h2 className="text-xs font-bold text-white">Agent Settings</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1 text-[11px]">Control API Host:</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono outline-none focus:border-indigo-500 text-xs"
              placeholder="127.0.0.1"
              required
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 text-[11px]">Control API Port:</label>
            <input
              type="number"
              min={1024}
              max={65535}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono outline-none focus:border-indigo-500 text-xs"
              placeholder="4100"
              required
            />
          </div>

          {error && <p className="text-[11px] text-rose-400 font-medium">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold flex items-center gap-1 shadow-sm"
            >
              <Check className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
