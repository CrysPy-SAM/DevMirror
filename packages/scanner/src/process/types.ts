/**
 * @devmirror/scanner - Process Inspection Contracts
 */

export interface ProcessInfo {
  pid: number;
  processName: string;
}

export interface IProcessInspector {
  /**
   * Identifies the process ID and executable name listening on a specific TCP port.
   * Returns null if process information is unavailable or inaccessible.
   */
  findProcessByPort(port: number): Promise<ProcessInfo | null>;
}
