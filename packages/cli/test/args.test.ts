import { describe, it, expect } from 'vitest';
import { parseCliArgs, HELP_TEXT, CLI_VERSION } from '../src/args.js';

describe('CLI Arguments Parser', () => {
  it('should parse empty arguments with default values', () => {
    const args = parseCliArgs([]);
    expect(args.port).toBeUndefined();
    expect(args.host).toBeUndefined();
    expect(args.help).toBe(false);
    expect(args.version).toBe(false);
    expect(args.overlay).toBe(false);
    expect(args.allowInsecureCertificates).toBe(false);
    expect(args.preferredProxyPort).toBeUndefined();
    expect(args.preferredControlPort).toBeUndefined();
  });

  it('should parse manual port flags', () => {
    expect(parseCliArgs(['--port', '5173']).port).toBe(5173);
    expect(parseCliArgs(['-p', '3000']).port).toBe(3000);
  });

  it('should parse manual host flags', () => {
    expect(parseCliArgs(['--host', 'localhost']).host).toBe('localhost');
    expect(parseCliArgs(['-H', '192.168.1.100']).host).toBe('192.168.1.100');
  });

  it('should parse help and version flags', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['--version']).version).toBe(true);
    expect(parseCliArgs(['-v']).version).toBe(true);
    expect(HELP_TEXT).toContain('npx devmirror');
    expect(CLI_VERSION).toBe('0.1.0');
  });

  it('should parse overlay and insecure flags', () => {
    expect(parseCliArgs(['--overlay']).overlay).toBe(true);
    expect(parseCliArgs(['--insecure']).allowInsecureCertificates).toBe(true);
    expect(parseCliArgs(['-k']).allowInsecureCertificates).toBe(true);
    expect(parseCliArgs(['--allow-insecure-certs']).allowInsecureCertificates).toBe(true);
  });

  it('should parse preferred proxy and control port options', () => {
    const args = parseCliArgs(['--proxy-port', '4050', '--control-port', '4150']);
    expect(args.preferredProxyPort).toBe(4050);
    expect(args.preferredControlPort).toBe(4150);
  });

  it('should reject invalid port numbers', () => {
    expect(() => parseCliArgs(['--port', '0'])).toThrow('Invalid --port');
    expect(() => parseCliArgs(['--port=-1'])).toThrow('Invalid --port');
    expect(() => parseCliArgs(['--port', '70000'])).toThrow('Invalid --port');
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow('Invalid --port');
    expect(() => parseCliArgs(['--proxy-port', '99999'])).toThrow('Invalid --proxy-port');
  });

  it('should reject unknown flags', () => {
    expect(() => parseCliArgs(['--foo'])).toThrow('CLI Argument Error');
  });
});
