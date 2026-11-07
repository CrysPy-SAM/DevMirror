import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Header } from '../src/components/Header.js';
import { StatusCard } from '../src/components/StatusCard.js';
import { QrSection } from '../src/components/QrSection.js';
import { Controls } from '../src/components/Controls.js';
import { DeviceList } from '../src/components/DeviceList.js';
import { SettingsModal } from '../src/components/SettingsModal.js';
import type { SanitizedSessionInfo, ConnectedClient } from '../src/types.js';

describe('Extension UI Components (React SSR Render Tests)', () => {
  const mockSession: SanitizedSessionInfo = {
    sessionId: 'sess-1234',
    createdAt: 1710000000,
    expiresAt: 1710043200,
    target: {
      host: '127.0.0.1',
      port: 5173,
      framework: 'vite',
      frameworkName: 'Vite React',
      isHttps: false
    },
    lanIp: '192.168.1.50',
    proxyPort: 4000,
    controlPort: 4100,
    mobileUrl: 'http://192.168.1.50:4000/?dm_token=kH7s...****',
    pairingMode: 'auto-trust',
    connectedClients: []
  };

  const mockDevices: ConnectedClient[] = [
    {
      id: 'c-1',
      ip: '192.168.1.105',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      deviceType: 'ios',
      connectedAt: 1710000500,
      lastPingAt: 1710000550,
      approved: true
    }
  ];

  describe('Header Component', () => {
    it('should render Online badge when agent is connected', () => {
      const html = renderToString(
        <Header isConnected={true} isRefreshing={false} onRefresh={() => {}} onOpenSettings={() => {}} />
      );
      expect(html).toContain('Agent Online');
      expect(html).toContain('DevMirror');
    });

    it('should render Offline badge when agent is disconnected', () => {
      const html = renderToString(
        <Header isConnected={false} isRefreshing={false} onRefresh={() => {}} onOpenSettings={() => {}} />
      );
      expect(html).toContain('Agent Offline');
    });
  });

  describe('StatusCard Component', () => {
    it('should display offline notice when agent is not connected', () => {
      const html = renderToString(
        <StatusCard session={null} proxyPort={4000} controlPort={4100} isConnected={false} />
      );
      expect(html).toContain('DevMirror Agent Not Reachable');
    });

    it('should display active session target, proxy port, and LAN IP', () => {
      const html = renderToString(
        <StatusCard session={mockSession} proxyPort={4000} controlPort={4100} isConnected={true} />
      );
      expect(html).toContain('Active Session');
      expect(html).toContain('Vite React');
      expect(html).toContain(':4000');
      expect(html).toContain('192.168.1.50');
    });

    it('should display idle state when no session is active', () => {
      const html = renderToString(
        <StatusCard session={null} proxyPort={4000} controlPort={4100} isConnected={true} />
      );
      expect(html).toContain('Ready (Idle)');
      expect(html).toContain('No Target');
    });
  });

  describe('QrSection Component', () => {
    it('should render QR code SVG and copy button when pairing URL is available', () => {
      const url = 'http://192.168.1.50:4000/?dm_token=secret123';
      const html = renderToString(<QrSection pairingUrl={url} hasActiveSession={true} />);
      expect(html).toContain('<svg');
      expect(html).toContain('Copy');
      expect(html).toContain(url);
    });

    it('should render empty state when session is inactive', () => {
      const html = renderToString(<QrSection pairingUrl={null} hasActiveSession={false} />);
      expect(html).toContain('No Active Mobile Preview');
    });
  });

  describe('Controls Component', () => {
    it('should render Stop Preview button when session is active', () => {
      const html = renderToString(
        <Controls
          session={mockSession}
          discoveredServers={[]}
          isConnected={true}
          isLoading={false}
          onStart={() => {}}
          onStop={() => {}}
        />
      );
      expect(html).toContain('Stop Preview Session');
    });

    it('should list discovered servers with Preview action when session is inactive', () => {
      const html = renderToString(
        <Controls
          session={null}
          discoveredServers={[
            {
              host: '127.0.0.1',
              port: 3000,
              url: 'http://127.0.0.1:3000',
              framework: 'nextjs',
              frameworkName: 'Next.js App',
              status: 'online',
              confidence: 'high',
              isHttps: false
            }
          ]}
          isConnected={true}
          isLoading={false}
          onStart={() => {}}
          onStop={() => {}}
        />
      );
      expect(html).toContain('Next.js App');
      expect(html).toContain('Preview');
    });
  });

  describe('DeviceList Component', () => {
    it('should render paired device details when devices are present', () => {
      const html = renderToString(<DeviceList devices={mockDevices} hasActiveSession={true} />);
      expect(html).toContain('192.168.1.105');
      expect(html).toContain('ios');
      expect(html).toContain('Paired');
    });

    it('should render waiting message when 0 devices are connected', () => {
      const html = renderToString(<DeviceList devices={[]} hasActiveSession={true} />);
      expect(html).toContain('Waiting for physical device scan...');
    });
  });

  describe('SettingsModal Component', () => {
    it('should render settings form when open', () => {
      const html = renderToString(
        <SettingsModal isOpen={true} config={{ host: '127.0.0.1', port: 4100 }} onClose={() => {}} onSave={() => {}} />
      );
      expect(html).toContain('Agent Settings');
      expect(html).toContain('Control API Port:');
      expect(html).toContain('4100');
    });

    it('should render nothing when closed', () => {
      const html = renderToString(
        <SettingsModal isOpen={false} config={{ host: '127.0.0.1', port: 4100 }} onClose={() => {}} onSave={() => {}} />
      );
      expect(html).toBe('');
    });
  });
});
