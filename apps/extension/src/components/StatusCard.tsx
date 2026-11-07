import React from 'react';
import { Globe, Radio, Server, Wifi } from 'lucide-react';
import type { SanitizedSessionInfo } from '../types.js';

interface StatusCardProps {
  session: SanitizedSessionInfo | null;
  proxyPort: number;
  controlPort: number;
  isConnected: boolean;
}

export const StatusCard: React.FC<StatusCardProps> = ({
  session,
  proxyPort,
  controlPort,
  isConnected
}) => {
  if (!isConnected) {
    return (
      <div className="p-3 bg-slate-800/40 border border-slate-700/50 rounded-xl text-center">
        <p className="text-xs text-rose-400 font-medium">DevMirror Agent Not Reachable</p>
        <p className="text-[11px] text-slate-400 mt-1">
          Make sure DevMirror is running locally in your terminal (<code className="text-indigo-300">npx devmirror</code>).
        </p>
      </div>
    );
  }

  const hasSession = session !== null;
  const target = session?.target;
  const frameworkName = target?.frameworkName || target?.framework || 'Custom Project';
  const targetUrl = target ? `http${target.isHttps ? 's' : ''}://${target.host}:${target.port}` : 'None';

  return (
    <div className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl space-y-2">
      <div className="flex items-center justify-between pb-2 border-b border-slate-700/40">
        <div className="flex items-center gap-1.5">
          <Radio className={`w-3.5 h-3.5 ${hasSession ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
          <span className="text-xs font-semibold text-white">
            {hasSession ? 'Active Session' : 'Ready (Idle)'}
          </span>
        </div>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            hasSession
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
              : 'bg-slate-700/50 text-slate-400'
          }`}
        >
          {hasSession ? 'Proxy Active' : 'No Target'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="space-y-0.5">
          <span className="text-slate-400 flex items-center gap-1">
            <Server className="w-3 h-3 text-slate-500" /> Target:
          </span>
          <p className="font-semibold text-white truncate" title={targetUrl}>
            {hasSession ? `${frameworkName} (: ${target?.port})` : 'None'}
          </p>
        </div>

        <div className="space-y-0.5">
          <span className="text-slate-400 flex items-center gap-1">
            <Globe className="w-3 h-3 text-slate-500" /> Proxy Port:
          </span>
          <p className="font-semibold text-indigo-300">
            {hasSession ? `:${proxyPort}` : `:${proxyPort} (standby)`}
          </p>
        </div>

        <div className="space-y-0.5">
          <span className="text-slate-400 flex items-center gap-1">
            <Wifi className="w-3 h-3 text-slate-500" /> Wi-Fi LAN IP:
          </span>
          <p className="font-mono text-slate-200 truncate">
            {session?.lanIp || 'Detecting...'}
          </p>
        </div>

        <div className="space-y-0.5">
          <span className="text-slate-400 flex items-center gap-1">
            <Radio className="w-3 h-3 text-slate-500" /> Control Port:
          </span>
          <p className="font-mono text-slate-200">
            :{controlPort}
          </p>
        </div>
      </div>
    </div>
  );
};
