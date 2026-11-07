import React from 'react';
import { Smartphone, Monitor, HelpCircle, CheckCircle2 } from 'lucide-react';
import type { ConnectedClient, DeviceType } from '../types.js';

interface DeviceListProps {
  devices: ConnectedClient[];
  hasActiveSession: boolean;
}

function getDeviceIcon(type: DeviceType) {
  switch (type) {
    case 'ios':
    case 'android':
      return <Smartphone className="w-3.5 h-3.5 text-indigo-400" />;
    case 'desktop':
      return <Monitor className="w-3.5 h-3.5 text-indigo-400" />;
    default:
      return <HelpCircle className="w-3.5 h-3.5 text-slate-500" />;
  }
}

export const DeviceList: React.FC<DeviceListProps> = ({
  devices,
  hasActiveSession
}) => {
  if (!hasActiveSession) {
    return null;
  }

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
        <span>Connected Devices</span>
        <span className="text-slate-400 font-normal">
          {devices.length} {devices.length === 1 ? 'device' : 'devices'}
        </span>
      </div>

      {devices.length === 0 ? (
        <div className="p-2.5 bg-slate-800/30 border border-slate-700/40 rounded-lg text-center">
          <p className="text-[11px] text-slate-400">Waiting for physical device scan...</p>
        </div>
      ) : (
        <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
          {devices.map((device) => {
            const connectedTime = new Date(device.connectedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            });

            return (
              <div
                key={device.id}
                className="flex items-center justify-between p-1.5 px-2 bg-slate-800/60 border border-slate-700/40 rounded-lg text-[11px]"
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                  {getDeviceIcon(device.deviceType)}
                  <div className="min-w-0">
                    <p className="font-mono text-white truncate text-[11px]">
                      {device.ip}
                    </p>
                    <p className="text-[9px] text-slate-400 capitalize">
                      {device.deviceType} • {connectedTime}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-emerald-400 text-[10px] shrink-0 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> Paired
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
