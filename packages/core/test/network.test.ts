import { describe, it, expect } from 'vitest';
import net from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import { LanIpResolver } from '../src/network/resolver.js';
import { PortManager } from '../src/network/port-manager.js';

describe('LanIpResolver', () => {
  it('should correctly identify RFC 1918 private IPv4 ranges', () => {
    expect(LanIpResolver.isPrivateIpv4('192.168.1.1')).toBe(true);
    expect(LanIpResolver.isPrivateIpv4('10.0.0.1')).toBe(true);
    expect(LanIpResolver.isPrivateIpv4('172.16.0.5')).toBe(true);
    expect(LanIpResolver.isPrivateIpv4('172.31.255.254')).toBe(true);

    expect(LanIpResolver.isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(LanIpResolver.isPrivateIpv4('172.32.0.1')).toBe(false);
    expect(LanIpResolver.isPrivateIpv4('127.0.0.1')).toBe(false);
    expect(LanIpResolver.isPrivateIpv4('invalid')).toBe(false);
  });

  it('should prioritize Wi-Fi/WLAN private IPv4 interface over virtual docker interfaces', () => {
    const mockInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
      lo: [
        { address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', mac: '', cidr: null }
      ],
      docker0: [
        { address: '172.17.0.1', family: 'IPv4', internal: false, netmask: '255.255.0.0', mac: '', cidr: null }
      ],
      'Wi-Fi': [
        { address: '192.168.1.45', family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '', cidr: null }
      ]
    };

    const resolver = new LanIpResolver(() => mockInterfaces);
    const result = resolver.resolve();

    expect(result.ip).toBe('192.168.1.45');
    expect(result.interfaceName).toBe('Wi-Fi');
    expect(result.isLoopback).toBe(false);
  });

  it('should fall back gracefully to 127.0.0.1 when no external interfaces exist', () => {
    const mockInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
      lo: [
        { address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', mac: '', cidr: null }
      ]
    };

    const resolver = new LanIpResolver(() => mockInterfaces);
    const result = resolver.resolve();

    expect(result.ip).toBe('127.0.0.1');
    expect(result.isLoopback).toBe(true);
  });
});

describe('PortManager', () => {
  it('should report availability of free ports and unavailability of occupied ports', async () => {
    const manager = new PortManager();

    // Occupy an ephemeral port
    const occupiedServer = net.createServer();
    await new Promise<void>((resolve) => {
      occupiedServer.listen(0, '127.0.0.1', () => resolve());
    });
    const occupiedPort = (occupiedServer.address() as net.AddressInfo).port;

    expect(await manager.isPortAvailable(occupiedPort)).toBe(false);

    // Close the server and check availability again
    await new Promise<void>((resolve) => occupiedServer.close(() => resolve()));
    expect(await manager.isPortAvailable(occupiedPort)).toBe(true);
  });

  it('should automatically fall back to the next port if preferred port is occupied', async () => {
    const manager = new PortManager();

    // Bind port 4800
    const testServer = net.createServer();
    await new Promise<void>((resolve) => {
      testServer.listen(4800, '127.0.0.1', () => resolve());
    });

    const selectedPort = await manager.findAvailablePort({
      preferredPort: 4800,
      host: '127.0.0.1'
    });

    expect(selectedPort).toBe(4801);

    await new Promise<void>((resolve) => testServer.close(() => resolve()));
    manager.releaseAll();
  });
});
