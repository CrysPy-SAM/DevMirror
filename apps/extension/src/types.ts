import type {
  SanitizedSessionInfo,
  TargetDevServer,
  ConnectedClient,
  DiscoveredDevServer,
  DeviceType
} from '@devmirror/shared';

export type {
  SanitizedSessionInfo,
  TargetDevServer,
  ConnectedClient,
  DiscoveredDevServer,
  DeviceType
};

export interface AgentHealth {
  status: string;
  version: string;
  uptimeSeconds: number;
}

export interface SessionResponse {
  session: SanitizedSessionInfo;
  activeControlPort: number;
  activeProxyPort: number;
}

export interface PairingUrlResponse {
  pairingUrl: string;
}

export interface DiscoverResponse {
  servers: DiscoveredDevServer[];
  total: number;
}

export interface DevicesResponse {
  devices: ConnectedClient[];
  total: number;
}

export interface ControlApiConfig {
  host: string;
  port: number;
}
