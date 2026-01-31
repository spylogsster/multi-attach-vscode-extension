/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { execSync } from 'child_process';
import { ProcessMonitor } from './processMonitor';
import { Logger } from './logger';
import { PlatformUtils } from './platform';

jest.mock('child_process');
jest.mock('./platform');

describe('ProcessMonitor', () => {
  let processMonitor: ProcessMonitor;
  let logger: Logger;
  const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

  beforeEach(() => {
    logger = new Logger();
    logger.initialize('Test');
    processMonitor = new ProcessMonitor(logger);
    jest.clearAllMocks();
  });

  describe('extractExecutableName', () => {
    it('should extract executable name from path', () => {
      (PlatformUtils.normalizeExecutableName as jest.Mock).mockReturnValue('app.exe');
      const result = ProcessMonitor.extractExecutableName('/path/to/app.exe');
      expect(result).toBe('app.exe');
    });

    it('should return null for empty path', () => {
      const result = ProcessMonitor.extractExecutableName('');
      expect(result).toBeNull();
    });

    it('should handle paths without extension', () => {
      (PlatformUtils.normalizeExecutableName as jest.Mock).mockReturnValue('app');
      const result = ProcessMonitor.extractExecutableName('/path/to/app');
      expect(result).toBe('app');
    });
  });

  describe('setExecutableName', () => {
    it('should set the executable name', () => {
      processMonitor.setExecutableName('test.exe');
      expect(processMonitor.getExecutableName()).toBe('test.exe');
    });

    it('should allow setting to null', () => {
      processMonitor.setExecutableName('test.exe');
      processMonitor.setExecutableName(null);
      expect(processMonitor.getExecutableName()).toBeNull();
    });
  });

  describe('getProcessIds - Windows', () => {
    beforeEach(() => {
      (PlatformUtils.isWindows as jest.Mock).mockReturnValue(true);
      processMonitor.setExecutableName('app.exe');
    });

    it('should return process IDs from tasklist', () => {
      mockExecSync.mockReturnValue('"app.exe","1234","Console","1","12,345 K"\n"app.exe","5678","Console","1","12,345 K"');

      const pids = processMonitor.getProcessIds();

      expect(pids).toEqual([1234, 5678]);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('tasklist /FI "IMAGENAME eq app.exe"'),
        expect.any(Object)
      );
    });

    it('should return empty array when no processes found', () => {
      mockExecSync.mockReturnValue('INFO: No tasks are running which match the specified criteria.');

      const pids = processMonitor.getProcessIds();

      expect(pids).toEqual([]);
    });

    it('should handle errors gracefully', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const pids = processMonitor.getProcessIds();

      expect(pids).toEqual([]);
    });

    it('should sanitize executable name', () => {
      processMonitor.setExecutableName('app;rm -rf.exe');
      mockExecSync.mockReturnValue('');

      processMonitor.getProcessIds();

      // Spaces are allowed (for macOS app names like "Chromium Browser"), but special chars like ; are removed
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('apprm -rf.exe'),
        expect.any(Object)
      );
    });
  });

  describe('getProcessIds - Unix', () => {
    beforeEach(() => {
      (PlatformUtils.isWindows as jest.Mock).mockReturnValue(false);
      processMonitor.setExecutableName('app');
    });

    it('should return process IDs from ps', () => {
      mockExecSync.mockReturnValue('  PID COMMAND\n 1234 app\n 5678 app');

      const pids = processMonitor.getProcessIds();

      expect(pids).toEqual([1234, 5678]);
      expect(mockExecSync).toHaveBeenCalledWith(
        'ps -A -o pid,comm',
        expect.any(Object)
      );
    });

    it('should match processes with full path', () => {
      mockExecSync.mockReturnValue('  PID COMMAND\n 1234 /usr/bin/app\n 5678 /usr/local/bin/app');

      const pids = processMonitor.getProcessIds();

      expect(pids).toEqual([1234, 5678]);
    });

    it('should return empty array when no processes found', () => {
      mockExecSync.mockReturnValue('  PID COMMAND\n');

      const pids = processMonitor.getProcessIds();

      expect(pids).toEqual([]);
    });

    it('should handle errors gracefully', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const pids = processMonitor.getProcessIds();

      expect(pids).toEqual([]);
    });
  });

  describe('isProcessRunning - Windows', () => {
    beforeEach(() => {
      (PlatformUtils.isWindows as jest.Mock).mockReturnValue(true);
    });

    it('should return true when process is running', () => {
      mockExecSync.mockReturnValue('"app.exe","1234","Console","1","12,345 K"');

      const result = processMonitor.isProcessRunning(1234);

      expect(result).toBe(true);
    });

    it('should return false when process is not running', () => {
      mockExecSync.mockReturnValue('INFO: No tasks are running which match the specified criteria.');

      const result = processMonitor.isProcessRunning(1234);

      expect(result).toBe(false);
    });

    it('should return false for invalid PID', () => {
      const result = processMonitor.isProcessRunning(-1);
      expect(result).toBe(false);
    });

    it('should return false for non-integer PID', () => {
      const result = processMonitor.isProcessRunning(123.45);
      expect(result).toBe(false);
    });

    it('should handle errors gracefully', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const result = processMonitor.isProcessRunning(1234);

      expect(result).toBe(false);
    });
  });

  describe('isProcessRunning - Unix', () => {
    beforeEach(() => {
      (PlatformUtils.isWindows as jest.Mock).mockReturnValue(false);
    });

    it('should return true when process is running', () => {
      mockExecSync.mockReturnValue('');

      const result = processMonitor.isProcessRunning(1234);

      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith('kill -0 1234', expect.any(Object));
    });

    it('should return false when process is not running', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('No such process');
      });

      const result = processMonitor.isProcessRunning(1234);

      expect(result).toBe(false);
    });
  });

  describe('trackPid', () => {
    it('should track a PID with session state', () => {
      processMonitor.trackPid(1234, 'session-1');
      expect(processMonitor.getSessionState(1234)).toBe('session-1');
    });

    it('should track a PID with attaching state', () => {
      processMonitor.trackPid(1234, 'attaching');
      expect(processMonitor.getSessionState(1234)).toBe('attaching');
    });

    it('should update existing PID', () => {
      processMonitor.trackPid(1234, 'session-1');
      processMonitor.trackPid(1234, 'session-2');
      expect(processMonitor.getSessionState(1234)).toBe('session-2');
    });
  });

  describe('untrackPid', () => {
    it('should untrack a PID', () => {
      processMonitor.trackPid(1234, 'session-1');
      processMonitor.untrackPid(1234);
      expect(processMonitor.getSessionState(1234)).toBeUndefined();
    });

    it('should handle untracking non-existent PID', () => {
      expect(() => processMonitor.untrackPid(9999)).not.toThrow();
    });
  });

  describe('isDebuggerAttached', () => {
    it('should return true for tracked PID', () => {
      processMonitor.trackPid(1234, 'session-1');
      expect(processMonitor.isDebuggerAttached(1234)).toBe(true);
    });

    it('should return false for untracked PID', () => {
      expect(processMonitor.isDebuggerAttached(1234)).toBe(false);
    });
  });

  describe('getTrackedPids', () => {
    it('should return all tracked PIDs', () => {
      processMonitor.trackPid(1234, 'session-1');
      processMonitor.trackPid(5678, 'session-2');

      const pids = processMonitor.getTrackedPids();

      expect(pids).toEqual(expect.arrayContaining([1234, 5678]));
      expect(pids).toHaveLength(2);
    });

    it('should return empty array when no PIDs tracked', () => {
      expect(processMonitor.getTrackedPids()).toEqual([]);
    });
  });

  describe('cleanupDeadProcesses', () => {
    beforeEach(() => {
      (PlatformUtils.isWindows as jest.Mock).mockReturnValue(true);
    });

    it('should remove dead processes', () => {
      processMonitor.trackPid(1234, 'session-1');
      processMonitor.trackPid(5678, 'session-2');

      mockExecSync.mockImplementation((cmd) => {
        if (cmd.toString().includes('1234')) {
          return 'INFO: No tasks are running';
        }
        return '"app.exe","5678","Console","1","12,345 K"';
      });

      const count = processMonitor.cleanupDeadProcesses();

      expect(count).toBe(1);
      expect(processMonitor.getTrackedPids()).toEqual([5678]);
    });

    it('should return 0 when no dead processes', () => {
      processMonitor.trackPid(1234, 'session-1');

      mockExecSync.mockReturnValue('"app.exe","1234","Console","1","12,345 K"');

      const count = processMonitor.cleanupDeadProcesses();

      expect(count).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all tracked PIDs and executable name', () => {
      processMonitor.setExecutableName('app.exe');
      processMonitor.trackPid(1234, 'session-1');
      processMonitor.trackPid(5678, 'session-2');

      processMonitor.clear();

      expect(processMonitor.getTrackedPids()).toEqual([]);
      expect(processMonitor.getExecutableName()).toBeNull();
    });
  });
});
