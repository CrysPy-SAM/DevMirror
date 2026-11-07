/**
 * @devmirror/core - LAN IP Resolver
 * Detects the machine's usable private LAN IPv4 address from network interfaces.
 */

import os, { type NetworkInterfaceInfo } from 'node:os';

export interface LanIpResolveResult {
  ip: string;
  interfaceName: string;
  isLoopback: boolean;
}

export type NetworkInterfaceProvider = () => NodeJS.Dict<NetworkInterfaceInfo[]>;

export class LanIpResolver {
  private readonly interfaceProvider: NetworkInterfaceProvider;

  constructor(interfaceProvider: NetworkInterfaceProvider = os.networkInterfaces) {
    this.interfaceProvider = interfaceProvider;
  }

  /**
   * Checks if an IPv4 address falls within standard RFC 1918 private address spaces:
   * - 10.0.0.0 - 10.255.255.255 (10.0.0.0/8)
   * - 172.16.0.0 - 172.31.255.255 (172.16.0.0/12)
   * - 192.168.0.0 - 192.168.255.255 (192.168.0.0/16)
   */
  public static isPrivateIpv4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return false;

    // 10.0.0.0/8
    if (parts[0] === 10) return true;

    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;

    return false;
  }

  /**
   * Assigns a score to interface names to prioritize physical Wi-Fi/Ethernet adapters
   * over virtualization bridges (Docker, WSL, Hyper-V, VirtualBox, Tailscale).
   */
  private static scoreInterfaceName(name: string): number {
    const lower = name.toLowerCase();

    // Deprioritize virtual adapters
    if (/docker|veth|br-|vbox|vmnet|tailscale|utun|tun|tap|wsl|hyper-v/.test(lower)) {
      return 1;
    }

    // Prioritize Wi-Fi / WLAN
    if (/wi-fi|wlan|wireless|en0|wl/.test(lower)) {
      return 10;
    }

    // Prioritize physical Ethernet
    if (/ethernet|eth|en[1-9]/.test(lower)) {
      return 8;
    }

    return 5;
  }

  /**
   * Discovers and returns the best private LAN IPv4 address.
   * If no valid LAN interface is active, falls back to 127.0.0.1.
   */
  public resolve(): LanIpResolveResult {
    const interfaces = this.interfaceProvider();
    const candidates: Array<{
      ip: string;
      interfaceName: string;
      isPrivate: boolean;
      score: number;
    }> = [];

    for (const [name, infos] of Object.entries(interfaces)) {
      if (!name || !infos) continue;

      for (const info of infos) {
        // Must be IPv4 and not an internal loopback address
        if (info.family !== 'IPv4' && (info as unknown as { family: number }).family !== 4) {
          continue;
        }

        if (info.internal) {
          continue;
        }

        // Ignore link-local (169.254.x.x) and loopback (127.x.x.x)
        if (info.address.startsWith('127.') || info.address.startsWith('169.254.')) {
          continue;
        }

        const isPrivate = LanIpResolver.isPrivateIpv4(info.address);
        const nameScore = LanIpResolver.scoreInterfaceName(name);
        const totalScore = (isPrivate ? 100 : 0) + nameScore;

        candidates.push({
          ip: info.address,
          interfaceName: name,
          isPrivate,
          score: totalScore
        });
      }
    }

    if (candidates.length === 0) {
      return {
        ip: '127.0.0.1',
        interfaceName: 'loopback-fallback',
        isLoopback: true
      };
    }

    // Sort by highest score first (private IPs first, then Wi-Fi/Ethernet)
    candidates.sort((a, b) => b.score - a.score);

    const winner = candidates[0];
    return {
      ip: winner.ip,
      interfaceName: winner.interfaceName,
      isLoopback: false
    };
  }
}
