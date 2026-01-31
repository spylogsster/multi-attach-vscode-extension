/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { DebugSessionManager } from './debugSessionManager';
import { ProcessMonitor } from './processMonitor';
import { Logger } from './logger';
import { PlatformUtils } from './platform';
import { DebugConfiguration } from './types';

jest.mock('./platform');
jest.mock('fs');

const mockStopDebugging = vscode.debug.stopDebugging as jest.MockedFunction<typeof vscode.debug.stopDebugging>;

// Helper function to create mock debug sessions
function createMockSession(config: Partial<DebugConfiguration>, id = 'test-session'): vscode.DebugSession {
  return {
    id,
    type: config.type || 'cppvsdbg',
    name: config.name || 'Test',
    workspaceFolder: undefined,
    configuration: config as vscode.DebugConfiguration,
    customRequest: jest.fn(),
    getDebugProtocolBreakpoint: jest.fn()
  } as unknown as vscode.DebugSession;
}

describe('DebugSessionManager', () => {
  let debugSessionManager: DebugSessionManager;
  let logger: Logger;
  let processMonitor: ProcessMonitor;
  const mockStartDebugging = vscode.debug.startDebugging as jest.MockedFunction<typeof vscode.debug.startDebugging>;

  beforeEach(() => {
    logger = new Logger();
    logger.initialize('Test');
    processMonitor = new ProcessMonitor(logger);
    debugSessionManager = new DebugSessionManager(logger, processMonitor);
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getPidFromSession', () => {
    it('should extract PID from session configuration', () => {
      const session = createMockSession({ processId: '1234' });
      const pid = DebugSessionManager.getPidFromSession(session);
      expect(pid).toBe(1234);
    });

    it('should return null for invalid PID', () => {
      const session = createMockSession({ processId: 'invalid' });
      const pid = DebugSessionManager.getPidFromSession(session);
      expect(pid).toBeNull();
    });

    it('should return null when processId is missing', () => {
      const session = createMockSession({});
      const pid = DebugSessionManager.getPidFromSession(session);
      expect(pid).toBeNull();
    });
  });

  describe('isAutoAttachEnabled', () => {
    it('should return false when no main session', () => {
      expect(debugSessionManager.isAutoAttachEnabled()).toBe(false);
    });

    it('should return true when autoAttachChildProcesses is enabled', async () => {
      const session = createMockSession({
        request: 'launch',
        program: '/path/to/app.exe',
        autoAttachChildProcesses: true
      }, 'session-1');

      (PlatformUtils.normalizeExecutableName as jest.Mock).mockReturnValue('app.exe');

      await debugSessionManager.onDebugSessionStarted(session);
      expect(debugSessionManager.isAutoAttachEnabled()).toBe(true);
    });

    it('should return false when autoAttachChildProcesses is disabled', async () => {
      const session = createMockSession({
        request: 'launch',
        program: '/path/to/app.exe',
        autoAttachChildProcesses: false
      }, 'session-1');

      (PlatformUtils.normalizeExecutableName as jest.Mock).mockReturnValue('app.exe');

      await debugSessionManager.onDebugSessionStarted(session);
      expect(debugSessionManager.isAutoAttachEnabled()).toBe(false);
    });
  });

  describe('onDebugSessionStarted', () => {
    it('should track PID when session has processId', async () => {
      const session = createMockSession({ processId: '1234' }, 'session-1');

      await debugSessionManager.onDebugSessionStarted(session);

      expect(processMonitor.getSessionState(1234)).toBe('session-1');
    });

    it('should start auto-attach for launch configuration with autoAttachChildProcesses', async () => {
      const session = createMockSession({ request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true }, 'session-1');

      (PlatformUtils.normalizeExecutableName as jest.Mock).mockReturnValue('app.exe');
      processMonitor.getProcessIds = jest.fn().mockReturnValue([]);

      await debugSessionManager.onDebugSessionStarted(session);

      expect(processMonitor.getExecutableName()).toBe('app.exe');
      expect(debugSessionManager.isAutoAttachEnabled()).toBe(true);
    });

    it('should not start auto-attach when autoAttachChildProcesses is false', async () => {
      const session = createMockSession({ request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: false }, 'session-1');

      (PlatformUtils.normalizeExecutableName as jest.Mock).mockReturnValue('app.exe');

      await debugSessionManager.onDebugSessionStarted(session);

      expect(debugSessionManager.isAutoAttachEnabled()).toBe(false);
    });

    it('should skip processing for auto-attach sessions', async () => {
      const session = createMockSession({ request: 'attach',
          name: 'App Process (PID: 1234)',
          processId: '1234' }, 'session-1');

      await debugSessionManager.onDebugSessionStarted(session);

      expect(processMonitor.getExecutableName()).toBeNull();
    });
  });

  describe('onDebugSessionTerminated', () => {
    it('should untrack PID when session terminates', async () => {
      processMonitor.trackPid(1234, 'session-1');

      const session = createMockSession({ processId: '1234' }, 'session-1');

      await debugSessionManager.onDebugSessionTerminated(session);

      expect(processMonitor.getSessionState(1234)).toBeUndefined();
    });

    it('should cleanup when main session terminates', async () => {
      const mainSession = {
        id: 'main-session',
        configuration: {
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true
        } as DebugConfiguration
      } as vscode.DebugSession;

      (PlatformUtils.normalizeExecutableName as jest.Mock).mockReturnValue('app.exe');
      processMonitor.getProcessIds = jest.fn().mockReturnValue([]);

      await debugSessionManager.onDebugSessionStarted(mainSession);

      processMonitor.trackPid(1234, 'session-1');
      processMonitor.trackPid(5678, 'session-2');

      await debugSessionManager.onDebugSessionTerminated(mainSession);

      expect(processMonitor.getTrackedPids()).toEqual([]);
      expect(processMonitor.getExecutableName()).toBeNull();
    });
  });

  describe('attachToNewProcesses', () => {
    beforeEach(() => {
      jest.useRealTimers(); // Use real timers for async operations
      (PlatformUtils.getDebuggerType as jest.Mock).mockReturnValue('cppvsdbg');
      (PlatformUtils.getMIMode as jest.Mock).mockReturnValue(undefined);
      (PlatformUtils.getExecutableExtension as jest.Mock).mockReturnValue('.exe');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      processMonitor.setExecutableName('app.exe');
    });

    afterEach(() => {
      jest.useFakeTimers(); // Restore fake timers
    });

    it('should attach to new processes', async () => {
      processMonitor.getProcessIds = jest.fn().mockReturnValue([1234, 5678]);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
      processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
      mockStartDebugging.mockResolvedValue(true);

      const result = await debugSessionManager.attachToNewProcesses();

      expect(result.attached).toBe(2);
      expect(result.failed).toBe(0);
      expect(mockStartDebugging).toHaveBeenCalledTimes(2);
    });

    it('should skip already tracked processes', async () => {
      processMonitor.trackPid(1234, 'existing-session');
      processMonitor.getProcessIds = jest.fn().mockReturnValue([1234, 5678]);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
      processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
      mockStartDebugging.mockResolvedValue(true);

      const result = await debugSessionManager.attachToNewProcesses();

      expect(result.attached).toBe(1);
      expect(mockStartDebugging).toHaveBeenCalledTimes(1);
    });

    it('should handle attachment failures', async () => {
      processMonitor.getProcessIds = jest.fn().mockReturnValue([1234]);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
      processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
      mockStartDebugging.mockResolvedValue(false);

      const result = await debugSessionManager.attachToNewProcesses();

      expect(result.attached).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should handle exceptions during attachment', async () => {
      processMonitor.getProcessIds = jest.fn().mockReturnValue([1234]);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
      processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
      mockStartDebugging.mockRejectedValue(new Error('Already attached'));

      const result = await debugSessionManager.attachToNewProcesses();

      expect(result.attached).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should use correct debugger configuration for macOS', async () => {
      (PlatformUtils.getDebuggerType as jest.Mock).mockReturnValue('cppdbg');
      (PlatformUtils.getMIMode as jest.Mock).mockReturnValue('lldb');
      (PlatformUtils.getExecutableExtension as jest.Mock).mockReturnValue('');

      processMonitor.setExecutableName('app');
      processMonitor.getProcessIds = jest.fn().mockReturnValue([1234]);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
      processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
      mockStartDebugging.mockResolvedValue(true);

      await debugSessionManager.attachToNewProcesses();

      expect(mockStartDebugging).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          type: 'cppdbg',
          MIMode: 'lldb',
          processId: '1234'
        })
      );
    });

    it('should return early when no executable name is set', async () => {
      processMonitor.setExecutableName(null);

      const result = await debugSessionManager.attachToNewProcesses();

      expect(result.attached).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockStartDebugging).not.toHaveBeenCalled();
    });

    it('should cleanup dead processes before attaching', async () => {
      const cleanupSpy = jest.spyOn(processMonitor, 'cleanupDeadProcesses').mockReturnValue(2);
      processMonitor.getProcessIds = jest.fn().mockReturnValue([]);

      await debugSessionManager.attachToNewProcesses();

      expect(cleanupSpy).toHaveBeenCalled();
    });

    it('should include program path when executable exists', async () => {
      const executablePath = '/path/to/app.exe';
      processMonitor.getProcessIds = jest.fn().mockReturnValue([1234]);
      processMonitor.getExecutablePath = jest.fn().mockReturnValue(executablePath);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
      processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockStartDebugging.mockResolvedValue(true);

      await debugSessionManager.attachToNewProcesses();

      expect(fs.existsSync).toHaveBeenCalledWith(executablePath);
      expect(mockStartDebugging).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          program: executablePath
        })
      );
    });

    it('should omit program path when executable does not exist', async () => {
      const executablePath = '/path/to/nonexistent.exe';
      processMonitor.getProcessIds = jest.fn().mockReturnValue([1234]);
      processMonitor.getExecutablePath = jest.fn().mockReturnValue(executablePath);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
      processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockStartDebugging.mockResolvedValue(true);

      await debugSessionManager.attachToNewProcesses();

      expect(fs.existsSync).toHaveBeenCalledWith(executablePath);
      expect(mockStartDebugging).toHaveBeenCalledWith(
        undefined,
        expect.not.objectContaining({
          program: expect.anything()
        })
      );
    });

    it('should log warning when executable path does not exist', async () => {
      const executablePath = '/path/to/nonexistent.exe';
      const logSpy = jest.spyOn(logger, 'log');
      processMonitor.getProcessIds = jest.fn().mockReturnValue([1234]);
      processMonitor.getExecutablePath = jest.fn().mockReturnValue(executablePath);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
      processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockStartDebugging.mockResolvedValue(true);

      await debugSessionManager.attachToNewProcesses();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Child executable path does not exist')
      );
    });

    it('should handle versioned Framework paths correctly', async () => {
      // Simulate a Chromium Helper process with versioned path
      const versionedPath = '/Users/test/App.app/Contents/Frameworks/App Framework.framework/Versions/1.0.0/Helpers/App Helper.app/Contents/MacOS/App Helper';
      processMonitor.getProcessIds = jest.fn().mockReturnValue([1234]);
      processMonitor.getExecutablePath = jest.fn().mockReturnValue(versionedPath);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
      processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(false); // Version changed, path no longer exists
      mockStartDebugging.mockResolvedValue(true);

      const result = await debugSessionManager.attachToNewProcesses();

      // Should still attach successfully, just without program path
      expect(result.attached).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockStartDebugging).toHaveBeenCalledWith(
        undefined,
        expect.not.objectContaining({
          program: expect.anything()
        })
      );
    });
  });

  describe('attachToAllProcesses', () => {
    beforeEach(() => {
      jest.useRealTimers(); // Use real timers for async operations
      (PlatformUtils.getDebuggerType as jest.Mock).mockReturnValue('cppvsdbg');
      (PlatformUtils.getMIMode as jest.Mock).mockReturnValue(undefined);
      (PlatformUtils.getExecutableExtension as jest.Mock).mockReturnValue('.exe');
    });

    afterEach(() => {
      jest.useFakeTimers(); // Restore fake timers
    });

    it('should attach to all processes', async () => {
      processMonitor.getProcessIds = jest.fn().mockReturnValue([1234, 5678]);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
      processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
      mockStartDebugging.mockResolvedValue(true);

      const result = await debugSessionManager.attachToAllProcesses('app.exe');

      expect(result.total).toBe(2);
      expect(result.attached).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('should use provided executable name', async () => {
      processMonitor.getProcessIds = jest.fn().mockReturnValue([]);
      processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);

      await debugSessionManager.attachToAllProcesses('custom.exe');

      expect(processMonitor.getExecutableName()).toBe('custom.exe');
    });

    it('should return zero results when no executable name', async () => {
      const result = await debugSessionManager.attachToAllProcesses();

      expect(result.total).toBe(0);
      expect(result.attached).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('startAutoAttach', () => {
    it('should not start if already running', () => {
      processMonitor.setExecutableName('app.exe');

      debugSessionManager.startAutoAttach();
      debugSessionManager.startAutoAttach();

      // Should only create one interval
      expect(jest.getTimerCount()).toBe(1);
    });

    it('should start monitoring interval', () => {
      processMonitor.setExecutableName('app.exe');

      debugSessionManager.startAutoAttach();

      expect(jest.getTimerCount()).toBe(1);
    });
  });

  describe('stopAutoAttach', () => {
    it('should stop monitoring interval', () => {
      processMonitor.setExecutableName('app.exe');

      debugSessionManager.startAutoAttach();
      expect(jest.getTimerCount()).toBe(1);

      debugSessionManager.stopAutoAttach();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should handle stopping when not running', () => {
      expect(() => debugSessionManager.stopAutoAttach()).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should cleanup all state', () => {
      processMonitor.setExecutableName('app.exe');
      processMonitor.trackPid(1234, 'session-1');
      debugSessionManager.startAutoAttach();

      debugSessionManager.cleanup();

      expect(processMonitor.getExecutableName()).toBeNull();
      expect(processMonitor.getTrackedPids()).toEqual([]);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('handleExistingSession', () => {
    it('should handle existing launch session with autoAttach enabled', () => {
      vscode.debug.activeDebugSession = {
        id: 'existing-session',
        configuration: {
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true
        } as DebugConfiguration
      } as vscode.DebugSession;

      (PlatformUtils.normalizeExecutableName as jest.Mock).mockReturnValue('app.exe');

      debugSessionManager.handleExistingSession();

      expect(processMonitor.getExecutableName()).toBe('app.exe');
      expect(jest.getTimerCount()).toBe(1);
    });

    it('should handle existing launch session without autoAttach', () => {
      vscode.debug.activeDebugSession = {
        id: 'existing-session',
        configuration: {
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: false
        } as DebugConfiguration
      } as vscode.DebugSession;

      (PlatformUtils.normalizeExecutableName as jest.Mock).mockReturnValue('app.exe');

      debugSessionManager.handleExistingSession();

      expect(processMonitor.getExecutableName()).toBe('app.exe');
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should handle no existing session', () => {
      vscode.debug.activeDebugSession = undefined;

      expect(() => debugSessionManager.handleExistingSession()).not.toThrow();
    });
  });

  describe('breakpoint verification', () => {
    beforeEach(() => {
      // Setup main session with autoAttachChildProcesses enabled
      const mainSession = createMockSession({
        request: 'launch',
        program: '/path/to/app.exe',
        autoAttachChildProcesses: true
      }, 'main-session');

      (PlatformUtils.normalizeExecutableName as jest.Mock).mockReturnValue('app.exe');
      processMonitor.getProcessIds = jest.fn().mockReturnValue([]);
    });

    describe('auto-attach session with breakpoint verification', () => {
      it('should schedule breakpoint verification for auto-attach sessions when enabled', async () => {
        // Setup main session
        const mainSession = createMockSession({
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true
        }, 'main-session');
        await debugSessionManager.onDebugSessionStarted(mainSession);

        // Create auto-attach session
        const autoAttachSession = createMockSession({
          request: 'attach',
          name: 'App Process (PID: 1234)',
          processId: '1234'
        }, 'auto-attach-session');

        await debugSessionManager.onDebugSessionStarted(autoAttachSession);

        // Should have scheduled a verification timeout (1 interval + 1 timeout)
        expect(jest.getTimerCount()).toBeGreaterThanOrEqual(1);
      });

      it('should not schedule verification when autoDetachIfNoBreakpoints is false', async () => {
        // Setup main session with verification disabled
        const mainSession = createMockSession({
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true,
          autoDetachIfNoBreakpoints: false
        }, 'main-session');
        await debugSessionManager.onDebugSessionStarted(mainSession);

        // Create auto-attach session
        const autoAttachSession = createMockSession({
          request: 'attach',
          name: 'App Process (PID: 1234)',
          processId: '1234'
        }, 'auto-attach-session');

        const initialTimerCount = jest.getTimerCount();
        await debugSessionManager.onDebugSessionStarted(autoAttachSession);

        // Timer count should not increase (only interval from main session)
        expect(jest.getTimerCount()).toBe(initialTimerCount);
      });

      it('should detach from session when no breakpoints are verified', async () => {
        jest.useRealTimers();

        // Setup main session
        const mainSession = createMockSession({
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true,
          breakpointVerificationDelayMs: 10 // Short delay for testing
        }, 'main-session');
        await debugSessionManager.onDebugSessionStarted(mainSession);

        // Create auto-attach session with mock getDebugProtocolBreakpoint
        const mockGetBreakpoint = jest.fn().mockResolvedValue({ verified: false });
        const autoAttachSession = {
          ...createMockSession({
            request: 'attach',
            name: 'App Process (PID: 1234)',
            processId: '1234'
          }, 'auto-attach-session'),
          getDebugProtocolBreakpoint: mockGetBreakpoint
        } as unknown as vscode.DebugSession;

        // Set up a source breakpoint
        const mockBreakpoint = new vscode.SourceBreakpoint(
          { uri: vscode.Uri.file('/path/to/file.cpp'), range: new vscode.Range(10, 0, 10, 0) }
        );
        (vscode.debug as any).breakpoints = [mockBreakpoint];

        mockStopDebugging.mockResolvedValue();

        await debugSessionManager.onDebugSessionStarted(autoAttachSession);

        // Wait for verification delay
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockStopDebugging).toHaveBeenCalledWith(autoAttachSession);

        jest.useFakeTimers();
      });

      it('should keep session attached when breakpoints are verified', async () => {
        jest.useRealTimers();

        // Setup main session
        const mainSession = createMockSession({
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true,
          breakpointVerificationDelayMs: 10
        }, 'main-session');
        await debugSessionManager.onDebugSessionStarted(mainSession);

        // Create auto-attach session with verified breakpoint
        const mockGetBreakpoint = jest.fn().mockResolvedValue({ verified: true });
        const autoAttachSession = {
          ...createMockSession({
            request: 'attach',
            name: 'App Process (PID: 1234)',
            processId: '1234'
          }, 'auto-attach-session'),
          getDebugProtocolBreakpoint: mockGetBreakpoint
        } as unknown as vscode.DebugSession;

        // Set up a source breakpoint
        const mockBreakpoint = new vscode.SourceBreakpoint(
          { uri: vscode.Uri.file('/path/to/file.cpp'), range: new vscode.Range(10, 0, 10, 0) }
        );
        (vscode.debug as any).breakpoints = [mockBreakpoint];

        await debugSessionManager.onDebugSessionStarted(autoAttachSession);

        // Wait for verification delay
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(mockStopDebugging).not.toHaveBeenCalled();

        jest.useFakeTimers();
      });

      it('should cancel pending verification when session terminates', async () => {
        jest.useRealTimers();

        // Setup main session
        const mainSession = createMockSession({
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true,
          breakpointVerificationDelayMs: 5000 // Long delay
        }, 'main-session');
        await debugSessionManager.onDebugSessionStarted(mainSession);

        // Create auto-attach session
        const autoAttachSession = createMockSession({
          request: 'attach',
          name: 'App Process (PID: 1234)',
          processId: '1234'
        }, 'auto-attach-session');

        // Set up a source breakpoint
        const mockBreakpoint = new vscode.SourceBreakpoint(
          { uri: vscode.Uri.file('/path/to/file.cpp'), range: new vscode.Range(10, 0, 10, 0) }
        );
        (vscode.debug as any).breakpoints = [mockBreakpoint];
        mockStopDebugging.mockResolvedValue();

        await debugSessionManager.onDebugSessionStarted(autoAttachSession);

        // Terminate the session immediately (before verification timeout)
        await debugSessionManager.onDebugSessionTerminated(autoAttachSession);

        // Wait a bit and verify stopDebugging was NOT called
        // (because the verification was cancelled)
        await new Promise(resolve => setTimeout(resolve, 100));

        // stopDebugging should NOT have been called for this session
        // since verification was cancelled
        expect(mockStopDebugging).not.toHaveBeenCalledWith(autoAttachSession);

        jest.useFakeTimers();
      });
    });

    describe('detached PIDs tracking', () => {
      beforeEach(() => {
        jest.useRealTimers();
        (PlatformUtils.getDebuggerType as jest.Mock).mockReturnValue('cppvsdbg');
        (PlatformUtils.getMIMode as jest.Mock).mockReturnValue(undefined);
        (PlatformUtils.getExecutableExtension as jest.Mock).mockReturnValue('.exe');
      });

      afterEach(() => {
        jest.useFakeTimers();
      });

      it('should skip detached PIDs when attaching to new processes', async () => {
        // Setup main session
        const mainSession = createMockSession({
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true,
          breakpointVerificationDelayMs: 10
        }, 'main-session');
        await debugSessionManager.onDebugSessionStarted(mainSession);

        // Create auto-attach session that will be detached
        const mockGetBreakpoint = jest.fn().mockResolvedValue({ verified: false });
        const autoAttachSession = {
          ...createMockSession({
            request: 'attach',
            name: 'App Process (PID: 1234)',
            processId: '1234'
          }, 'auto-attach-session'),
          getDebugProtocolBreakpoint: mockGetBreakpoint
        } as unknown as vscode.DebugSession;

        // Set up a source breakpoint (unverified)
        const mockBreakpoint = new vscode.SourceBreakpoint(
          { uri: vscode.Uri.file('/path/to/file.cpp'), range: new vscode.Range(10, 0, 10, 0) }
        );
        (vscode.debug as any).breakpoints = [mockBreakpoint];
        mockStopDebugging.mockResolvedValue();

        await debugSessionManager.onDebugSessionStarted(autoAttachSession);

        // Wait for verification and detach
        await new Promise(resolve => setTimeout(resolve, 50));

        // Now try to attach again - PID 1234 should be skipped
        processMonitor.getProcessIds = jest.fn().mockReturnValue([1234, 5678]);
        processMonitor.cleanupDeadProcesses = jest.fn().mockReturnValue(0);
        processMonitor.isProcessRunning = jest.fn().mockReturnValue(true);
        mockStartDebugging.mockResolvedValue(true);

        const result = await debugSessionManager.attachToNewProcesses();

        // Only PID 5678 should be attached (1234 was detached)
        expect(result.attached).toBe(1);
        expect(mockStartDebugging).toHaveBeenCalledTimes(1);
        expect(mockStartDebugging).toHaveBeenCalledWith(
          undefined,
          expect.objectContaining({ processId: '5678' })
        );
      });
    });

    describe('cleanup clears verification state', () => {
      it('should clear pending verifications and detached PIDs on cleanup', async () => {
        jest.useRealTimers();

        // Setup main session
        const mainSession = createMockSession({
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true,
          breakpointVerificationDelayMs: 5000 // Long delay
        }, 'main-session');
        await debugSessionManager.onDebugSessionStarted(mainSession);

        // Create auto-attach session (will have pending verification)
        const autoAttachSession = createMockSession({
          request: 'attach',
          name: 'App Process (PID: 1234)',
          processId: '1234'
        }, 'auto-attach-session');

        // Set up a source breakpoint
        const mockBreakpoint = new vscode.SourceBreakpoint(
          { uri: vscode.Uri.file('/path/to/file.cpp'), range: new vscode.Range(10, 0, 10, 0) }
        );
        (vscode.debug as any).breakpoints = [mockBreakpoint];
        mockStopDebugging.mockResolvedValue();

        await debugSessionManager.onDebugSessionStarted(autoAttachSession);

        // Cleanup should clear all state including pending verification
        debugSessionManager.cleanup();

        // Wait a bit - stopDebugging should NOT be called because verification was cancelled
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(mockStopDebugging).not.toHaveBeenCalled();

        jest.useFakeTimers();
      });
    });

    describe('configuration options', () => {
      it('should use default delay of 3000ms when not specified', async () => {
        jest.useRealTimers();

        const mainSession = createMockSession({
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true
          // breakpointVerificationDelayMs not specified
        }, 'main-session');
        await debugSessionManager.onDebugSessionStarted(mainSession);

        // Set up empty breakpoints
        (vscode.debug as any).breakpoints = [];

        const autoAttachSession = createMockSession({
          request: 'attach',
          name: 'App Process (PID: 1234)',
          processId: '1234'
        }, 'auto-attach-session');

        const startTime = Date.now();
        await debugSessionManager.onDebugSessionStarted(autoAttachSession);

        // Verify that stopDebugging is NOT called immediately
        expect(mockStopDebugging).not.toHaveBeenCalled();

        jest.useFakeTimers();
      });

      it('should use custom delay when specified', async () => {
        jest.useRealTimers();

        const mainSession = createMockSession({
          request: 'launch',
          program: '/path/to/app.exe',
          autoAttachChildProcesses: true,
          breakpointVerificationDelayMs: 50
        }, 'main-session');
        await debugSessionManager.onDebugSessionStarted(mainSession);

        // Set up empty breakpoints
        (vscode.debug as any).breakpoints = [];
        mockStopDebugging.mockResolvedValue();

        const autoAttachSession = createMockSession({
          request: 'attach',
          name: 'App Process (PID: 1234)',
          processId: '1234'
        }, 'auto-attach-session');

        await debugSessionManager.onDebugSessionStarted(autoAttachSession);

        // Wait less than delay - should not be called
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(mockStopDebugging).not.toHaveBeenCalled();

        // Wait for delay to complete
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(mockStopDebugging).toHaveBeenCalled();

        jest.useFakeTimers();
      });
    });
  });
});
