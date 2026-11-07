import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, QrCode } from 'lucide-react';

interface QrSectionProps {
  pairingUrl: string | null;
  hasActiveSession: boolean;
}

export const QrSection: React.FC<QrSectionProps> = ({
  pairingUrl,
  hasActiveSession
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = async () => {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  if (!hasActiveSession) {
    return (
      <div className="p-6 bg-slate-800/30 border border-dashed border-slate-700/60 rounded-xl text-center space-y-2">
        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 mx-auto">
          <QrCode className="w-5 h-5" />
        </div>
        <p className="text-xs font-medium text-slate-300">No Active Mobile Preview</p>
        <p className="text-[11px] text-slate-500">
          Select or start a local dev server below to generate your pairing QR code.
        </p>
      </div>
    );
  }

  if (!pairingUrl) {
    return (
      <div className="p-4 bg-slate-800/50 border border-slate-700/60 rounded-xl text-center">
        <p className="text-xs text-slate-400 animate-pulse">Generating secure pairing URL...</p>
      </div>
    );
  }

  return (
    <div className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl flex flex-col items-center text-center space-y-2.5">
      <div className="p-2.5 bg-white rounded-lg shadow-md shadow-black/30">
        <QRCodeSVG
          value={pairingUrl}
          size={144}
          level="M"
          includeMargin={false}
        />
      </div>

      <div className="w-full space-y-1.5">
        <p className="text-[11px] text-slate-400 font-medium">
          Scan with your phone camera on same Wi-Fi
        </p>
        <div className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-700/60 rounded-lg p-1.5">
          <input
            type="text"
            readOnly
            value={pairingUrl}
            className="bg-transparent text-[10px] text-slate-300 font-mono w-full outline-none select-all px-1 truncate"
            title={pairingUrl}
          />
          <button
            onClick={handleCopy}
            title="Copy pairing URL"
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-all shrink-0 ${
              copied
                ? 'bg-emerald-600 text-white'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
