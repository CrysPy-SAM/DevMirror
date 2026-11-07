/**
 * @devmirror/extension - Control API React Hook
 * Manages periodic polling, state synchronization, and user actions while popup is mounted.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ControlApiClient, DEFAULT_CONFIG } from '../api/client.js';
import type {
  AgentHealth,
  SessionResponse,
  ConnectedClient,
  DiscoveredDevServer,
  ControlApiConfig,
  TargetDevServer
} from '../types.js';

export function useControlApi() {
  const [config, setConfig] = useState<ControlApiConfig>(DEFAULT_CONFIG);
  const clientRef = useRef<ControlApiClient>(new ControlApiClient(DEFAULT_CONFIG));

  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [sessionData, setSessionData] = useState<SessionResponse | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [devices, setDevices] = useState<ConnectedClient[]>([]);
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredDevServer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load config from chrome.storage.local if available
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['controlHost', 'controlPort'], (res) => {
        if (res.controlPort) {
          const loaded: ControlApiConfig = {
            host: res.controlHost || DEFAULT_CONFIG.host,
            port: Number(res.controlPort) || DEFAULT_CONFIG.port
          };
          setConfig(loaded);
          clientRef.current.updateConfig(loaded);
        }
      });
    }
  }, []);

  const fetchState = useCallback(async (manual: boolean = false) => {
    if (manual) setIsRefreshing(true);
    const client = clientRef.current;

    try {
      // 1. Health check
      const h = await client.checkHealth();
      setHealth(h);

      if (!h) {
        setSessionData(null);
        setPairingUrl(null);
        setDevices([]);
        setDiscoveredServers([]);
        setError('Local DevMirror agent is unreachable.');
        return;
      }

      setError(null);

      // 2. Session info
      const s = await client.getSession();
      setSessionData(s);

      // 3. Pairing URL if session is active
      if (s) {
        const pUrl = await client.getPairingUrl();
        setPairingUrl(pUrl);
      } else {
        setPairingUrl(null);
      }

      // 4. Devices
      const devRes = await client.getDevices();
      setDevices(devRes.devices || []);

      // 5. Discovered dev servers (only if no active session or requested)
      if (!s) {
        const discRes = await client.discoverServers();
        setDiscoveredServers(discRes.servers || []);
      }
    } catch (err: any) {
      setError(err.message || 'Error communicating with DevMirror agent.');
    } finally {
      setIsLoading(false);
      if (manual) setIsRefreshing(false);
    }
  }, []);

  // Poll every 2.5 seconds while popup is open
  useEffect(() => {
    fetchState(false);
    const timer = setInterval(() => {
      fetchState(false);
    }, 2500);

    return () => clearInterval(timer);
  }, [fetchState]);

  const startPreview = async (target: Partial<TargetDevServer> & { port: number }) => {
    setIsLoading(true);
    setError(null);
    try {
      const success = await clientRef.current.startSession(target);
      if (!success) {
        setError('Failed to start preview session.');
      }
      await fetchState(false);
    } catch (err: any) {
      setError(err.message || 'Error starting session.');
    } finally {
      setIsLoading(false);
    }
  };

  const stopPreview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const success = await clientRef.current.stopSession();
      if (!success) {
        setError('Failed to stop preview session.');
      }
      await fetchState(false);
    } catch (err: any) {
      setError(err.message || 'Error stopping session.');
    } finally {
      setIsLoading(false);
    }
  };

  const updateConfig = (newConfig: Partial<ControlApiConfig>) => {
    const updated = { ...config, ...newConfig };
    setConfig(updated);
    clientRef.current.updateConfig(updated);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        controlHost: updated.host,
        controlPort: updated.port
      });
    }

    fetchState(true);
  };

  return {
    config,
    health,
    isAgentConnected: health !== null,
    session: sessionData?.session ?? null,
    proxyPort: sessionData?.activeProxyPort ?? 4000,
    controlPort: sessionData?.activeControlPort ?? config.port,
    pairingUrl,
    devices,
    discoveredServers,
    isLoading,
    isRefreshing,
    error,
    refresh: () => fetchState(true),
    startPreview,
    stopPreview,
    updateConfig
  };
}
