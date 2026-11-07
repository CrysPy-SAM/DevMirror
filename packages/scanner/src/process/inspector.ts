/**
 * @devmirror/scanner - Process Inspector Factory & Fallback
 * Dispatches to OS-specific process inspector or returns null gracefully.
 */

import os from 'node:os';
import type { IProcessInspector, ProcessInfo } from './types.js';
import { WindowsProcessInspector } from './windows.js';

export class ProcessInspector implements IProcessInspector {
  private readonly delegate: IProcessInspector | null;

  constructor(customInspector?: IProcessInspector) {
    if (customInspector) {
      this.delegate = customInspector;
    } else if (os.platform() === 'win32') {
      this.delegate = new WindowsProcessInspector();
    } else {
      // Future milestone: Linux/macOS lsof inspector
      this.delegate = null;
    }
  }

  public async findProcessByPort(port: number): Promise<ProcessInfo | null> {
    if (!this.delegate) {
      return null;
    }

    try {
      return await this.delegate.findProcessByPort(port);
    } catch {
      return null;
    }
  }
}
