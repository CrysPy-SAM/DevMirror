import React, { useState } from 'react';
import { useControlApi } from './hooks/useControlApi.js';
import { Header } from './components/Header.js';
import { StatusCard } from './components/StatusCard.js';
import { QrSection } from './components/QrSection.js';
import { Controls } from './components/Controls.js';
import { DeviceList } from './components/DeviceList.js';
import { SettingsModal } from './components/SettingsModal.js';
import { AlertCircle } from 'lucide-react';

export const App: React.FC = () => {
  const {
    config,
    isAgentConnected,
    session,
    proxyPort,
    controlPort,
    pairingUrl,
    devices,
    discoveredServers,
    isLoading,
    isRefreshing,
    error,
    refresh,
    startPreview,
    stopPreview,
    updateConfig
  } = useControlApi();

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  return (
    <div className="flex flex-col min-h-[560px] bg-slate-900 text-slate-100 text-xs">
      <Header
        isConnected={isAgentConnected}
        isRefreshing={isRefreshing}
        onRefresh={refresh}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <main className="flex-1 p-3.5 space-y-3 overflow-y-auto">
        {error && (
          <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-center gap-2 text-rose-300 text-[11px]">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="truncate">{error}</span>
          </div>
        )}

        <StatusCard
          session={session}
          proxyPort={proxyPort}
          controlPort={controlPort}
          isConnected={isAgentConnected}
        />

        {isAgentConnected && (
          <QrSection
            pairingUrl={pairingUrl}
            hasActiveSession={session !== null}
          />
        )}

        <Controls
          session={session}
          discoveredServers={discoveredServers}
          isConnected={isAgentConnected}
          isLoading={isLoading}
          onStart={startPreview}
          onStop={stopPreview}
        />

        <DeviceList
          devices={devices}
          hasActiveSession={session !== null}
        />
      </main>

      <footer className="px-3.5 py-2 bg-slate-900 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
        <span>DevMirror Chrome Extension</span>
        <span>Connected to :{controlPort}</span>
      </footer>

      <SettingsModal
        isOpen={isSettingsOpen}
        config={config}
        onClose={() => setIsSettingsOpen(false)}
        onSave={updateConfig}
      />
    </div>
  );
};
