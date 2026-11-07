import { describe, it, expect } from 'vitest';
import { ProcessInspector } from '../src/process/inspector.js';
import { WindowsProcessInspector } from '../src/process/windows.js';
import type { IProcessInspector } from '../src/process/types.js';

describe('ProcessInspector', () => {
  it('should delegate to a custom inspector if provided', async () => {
    const mockInspector: IProcessInspector = {
      findProcessByPort: async (port: number) => {
        if (port === 3000) {
          return { pid: 1234, processName: 'node.exe' };
        }
        return null;
      }
    };

    const inspector = new ProcessInspector(mockInspector);
    const result = await inspector.findProcessByPort(3000);
    expect(result).toEqual({ pid: 1234, processName: 'node.exe' });

    const notFound = await inspector.findProcessByPort(8080);
    expect(notFound).toBeNull();
  });

  it('should return null when delegate throws an error', async () => {
    const errorInspector: IProcessInspector = {
      findProcessByPort: async () => {
        throw new Error('Permission denied');
      }
    };

    const inspector = new ProcessInspector(errorInspector);
    const result = await inspector.findProcessByPort(3000);
    expect(result).toBeNull();
  });

  it('should safely return null for unused/non-existent ports on Windows', async () => {
    // WindowsProcessInspector uses short timeout (500ms)
    const winInspector = new WindowsProcessInspector(500);
    // Port 65432 should not be listening or fail gracefully
    const result = await winInspector.findProcessByPort(65432);
    // Should safely return null without throwing
    expect(result).toBeNull();
  });
});
