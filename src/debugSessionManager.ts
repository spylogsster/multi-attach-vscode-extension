/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from './logger';
import { ProcessMonitor } from './processMonitor';
import { AttachResult, AttachAllResult, DebugConfiguration, SetupCommand } from './types';
import { PlatformUtils } from './platform';

/**
 * Manages debug sessions and auto-attach functionality
 */
export class DebugSessionManager {
  private mainLaunchSession: vscode.DebugSession | null = null;
  private autoAttachInterval: NodeJS.Timeout | null = null;
  private mainSetupCommands: SetupCommand[] | undefined = undefined;
  private mainProgramPath: string | undefined = undefined;
  private mainSourceFileMap: Record<string, string> | undefined = undefined;
  private mainSymbolSearchPath: string | undefined = undefined;
  private mainAdditionalSOLibSearchPath: string | undefined = undefined;
  private mainCwd: string | undefined = undefined;
  private mainMiDebuggerPath: string | undefined = undefined;
  private mainLaunchedPid: number | null = null;
  private readonly ATTACH_INTERVAL_MS = 2000;
  private readonly ATTACH_DELAY_MS = 500;
  private readonly INITIAL_SCAN_DELAY_MS = 1500;
  private readonly DEFAULT_BREAKPOINT_VERIFICATION_DELAY_MS = 3000;

  // Breakpoint verification state
  private pendingVerification: Map<string, NodeJS.Timeout> = new Map(); // sessionId -> timeout
  private detachedPids: Set<number> = new Set(); // PIDs detached due to no breakpoints

  constructor(
    private logger: Logger,
    private processMonitor: ProcessMonitor
  ) {}

  /**
   * Get the PID from a debug session configuration
   */
  static getPidFromSession(session: vscode.DebugSession): number | null {
    const config = session.configuration as DebugConfiguration;

    if (config.processId) {
      const pid = parseInt(config.processId);
      return isNaN(pid) ? null : pid;
    }

    return null;
  }

  /**
   * Check if auto-attach is enabled in the configuration
   */
  isAutoAttachEnabled(): boolean {
    if (!this.mainLaunchSession) {
      return false;
    }
    const config = this.mainLaunchSession.configuration as DebugConfiguration;
    return config.autoAttachChildProcesses === true;
  }

  /**
   * Handle debug session start
   */
  async onDebugSessionStarted(session: vscode.DebugSession): Promise<void> {
    const config = session.configuration as DebugConfiguration;
    const pid = DebugSessionManager.getPidFromSession(session);

    // Track any session with a PID
    if (pid) {
      const existingState = this.processMonitor.getSessionState(pid);

      if (!existingState || existingState === 'attaching') {
        this.processMonitor.trackPid(pid, session.id);
        this.logger.log(`Tracking debug session: PID ${pid}, Session ${session.id}`);
      } else if (existingState !== session.id && existingState !== 'external') {
        this.logger.log(`WARNING: PID ${pid} already tracked with different session ${existingState}, got ${session.id}`);
      }
    }

    // If this is an auto-attach session, schedule breakpoint verification if enabled
    if (config.request === 'attach' && config.name?.includes('Process (PID:')) {
      this.logger.log(`Auto-attach session started for PID ${pid}`);
      if (this.shouldVerifyBreakpoints()) {
        this.scheduleBreakpointVerification(session);
      }
      return;
    }

    // Handle main launch configuration
    if (config.request === 'launch' && config.program) {
      const execName = ProcessMonitor.extractExecutableName(config.program, this.logger);

      if (execName) {
        this.processMonitor.setExecutableName(execName);
        this.mainLaunchSession = session;
        // Store setupCommands and program path for use in child attach configs
        this.mainSetupCommands = config.setupCommands;
        this.mainProgramPath = config.program;

        // Store source-related settings for child attach configs
        this.mainSourceFileMap = config.sourceFileMap;
        this.mainSymbolSearchPath = config.symbolSearchPath;
        this.mainAdditionalSOLibSearchPath = config.additionalSOLibSearchPath;
        this.mainCwd = config.cwd;
        this.mainMiDebuggerPath = config.miDebuggerPath;

        this.logger.log(`Main launch config received:`);
        this.logger.log(`  type: ${config.type}`);
        this.logger.log(`  program: ${config.program}`);
        this.logger.log(`  MIMode: ${config.MIMode || 'not set'}`);
        this.logger.log(`  cwd: ${config.cwd || 'not set'}`);
        this.logger.log(`  miDebuggerPath: ${config.miDebuggerPath || 'not set'}`);
        this.logger.log(`  autoAttachChildProcesses: ${config.autoAttachChildProcesses}`);
        this.logger.log(`  setupCommands: ${config.setupCommands ? config.setupCommands.length + ' commands' : 'not set'}`);
        if (config.setupCommands && config.setupCommands.length > 0) {
          this.logger.log(`  setupCommands detail: ${JSON.stringify(config.setupCommands)}`);
        }
        this.logger.log(`  sourceFileMap: ${config.sourceFileMap ? JSON.stringify(config.sourceFileMap) : 'not set'}`);
        this.logger.log(`  symbolSearchPath: ${config.symbolSearchPath || 'not set'}`);

        if (config.autoAttachChildProcesses === true) {
          this.logger.log(`MAIN debug session started for ${execName} with autoAttachChildProcesses enabled`);
          this.logger.log('Beginning auto-attach monitoring');

          this.startAutoAttach();

          // Do an immediate scan to detect the main launched process PID
          setTimeout(async () => {
            this.logger.log('Starting initial process scan...');
            // Detect the main launched process (first process with exact basename match)
            await this.detectMainLaunchedProcess();
            await this.attachToNewProcesses();
          }, this.INITIAL_SCAN_DELAY_MS);
        } else {
          this.logger.log(`MAIN debug session started for ${execName}`);
          this.logger.log('autoAttachChildProcesses is not enabled in launch configuration');
        }
      }
    }
  }

  /**
   * Handle debug session termination
   */
  async onDebugSessionTerminated(session: vscode.DebugSession): Promise<void> {
    const pid = DebugSessionManager.getPidFromSession(session);

    // Cancel any pending breakpoint verification for this session
    this.cancelPendingVerification(session.id);

    // Remove the terminated session from tracked PIDs
    if (pid && this.processMonitor.isDebuggerAttached(pid)) {
      this.logger.log(`Debug session terminated for PID ${pid}, removing from tracked list`);
      this.processMonitor.untrackPid(pid);
    }

    // Check if this was the main launch session
    if (this.mainLaunchSession && session.id === this.mainLaunchSession.id) {
      this.logger.log('Main launch session stopped, stopping all child debug sessions');

      // Stop all child debug sessions
      await this.stopAllChildSessions();

      const trackedCount = this.processMonitor.getTrackedPids().length;
      this.cleanup();
      this.logger.log(`Cleaned up ${trackedCount} tracked session(s)`);
    }

    // If all debug sessions are stopped, clean up
    setTimeout(() => {
      if (!vscode.debug.activeDebugSession) {
        this.logger.log('All debug sessions stopped, cleaning up');
        this.cleanup();
      }
    }, 1000);
  }

  /**
   * Attach to new processes that aren't already attached
   */
  async attachToNewProcesses(): Promise<AttachResult> {
    const execName = this.processMonitor.getExecutableName();
    if (!execName) {
      this.logger.log('No executable name set, cannot attach to processes');
      return { attached: 0, failed: 0 };
    }

    // Clean up dead processes first
    const cleaned = this.processMonitor.cleanupDeadProcesses();
    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} dead process(es)`);
    }

    const allPids = this.processMonitor.getProcessIds();

    // Filter out PIDs that are already attached or were detached due to no breakpoints
    const newPids = allPids.filter(pid =>
      !this.processMonitor.isDebuggerAttached(pid) && !this.detachedPids.has(pid)
    );

    if (newPids.length === 0) {
      return { attached: 0, failed: 0 };
    }

    this.logger.log(`Attaching to ${newPids.length} process(es): [${newPids.join(', ')}]`);

    let attached = 0;
    let failed = 0;

    for (const pid of newPids) {
      // Double-check before attaching (race condition prevention)
      if (this.processMonitor.isDebuggerAttached(pid)) {
        continue; // Already being handled
      }

      // Check if process is still running before attempting attach
      if (!this.processMonitor.isProcessRunning(pid)) {
        continue; // Process exited before we could attach
      }

      // Mark as "being attached" immediately
      this.processMonitor.trackPid(pid, 'attaching');
      this.logger.log(`Attempting to attach to PID ${pid}...`);

      try {
        const debuggerType = PlatformUtils.getDebuggerType();
        const miMode = PlatformUtils.getMIMode();
        const executableBasename = path.basename(execName, PlatformUtils.getExecutableExtension());

        // Get the actual executable path for this specific child process
        const childExecutablePath = this.processMonitor.getExecutablePath(pid);
        const childExecutableBasename = childExecutablePath ? path.basename(childExecutablePath) : executableBasename;

        // Determine the program path to use for symbol loading
        // For Chromium-based apps, child processes that run main application code (Helper processes)
        // need to use the main program path for symbol loading, as symbols are in the Framework
        // For utility processes (crashpad, etc.), we can use their own path
        const programPathForSymbols = this.getProgramPathForSymbolLoading(childExecutablePath);

        // Build attach configuration
        // Note: cppdbg uses 'processId' as a string for all platforms
        // On macOS with LLDB, 'program' field is required for symbol loading

        // Build setupCommands - include original commands plus source-map for LLDB
        let setupCommands = this.mainSetupCommands ? [...this.mainSetupCommands] : [];

        // For LLDB on macOS, add commands to help with source mapping and breakpoints
        if (miMode === 'lldb') {
          // Set Chromium LLDB environment variable (required for lldbinit.py to work properly)
          setupCommands.push({
            description: 'Set Chromium LLDB init environment',
            text: 'settings set target.env-vars CHROMIUM_LLDBINIT_SOURCED=1',
            ignoreFailures: true
          });

          if (this.mainCwd) {
            setupCommands.push({
              description: 'Set source map for attach',
              text: `settings set target.source-map ../.. "${this.mainCwd}"`,
              ignoreFailures: true
            });
          }

          // Add Framework directory to image search paths for symbol loading
          const frameworkPath = this.getFrameworkPath();
          if (frameworkPath) {
            setupCommands.push({
              description: 'Add Framework to image search path',
              text: `settings append target.exec-search-paths "${frameworkPath}"`,
              ignoreFailures: true
            });
          }

          // Add app bundle directory to search paths (where dylibs/symbols are)
          const appBundleDir = this.getAppBundleDirectory();
          if (appBundleDir) {
            setupCommands.push({
              description: 'Add app bundle directory to search paths',
              text: `settings append target.exec-search-paths "${appBundleDir}"`,
              ignoreFailures: true
            });
          }

          // Enable settings that help with breakpoints in attached processes
          setupCommands.push({
            description: 'Enable breakpoint auto-apply',
            text: 'settings set target.auto-apply-fixups true',
            ignoreFailures: true
          });
          setupCommands.push({
            description: 'Set inline breakpoint strategy',
            text: 'settings set target.inline-breakpoint-strategy always',
            ignoreFailures: true
          });
          setupCommands.push({
            description: 'Disable prologue skip for accurate breakpoints',
            text: 'settings set target.skip-prologue false',
            ignoreFailures: true
          });
        }

        // Build sourceFileMap - use main config's map plus auto-generate mapping for relative paths
        // This is handled by VS Code/cppdbg directly, not LLDB
        let sourceFileMap: Record<string, string> = {};
        if (this.mainSourceFileMap) {
          sourceFileMap = { ...this.mainSourceFileMap };
        }
        // Map relative paths (../../) to the source directory
        if (this.mainCwd) {
          sourceFileMap['../..'] = this.mainCwd;
          sourceFileMap['/../../'] = this.mainCwd;
        }

        const targetArch = PlatformUtils.getTargetArchitecture();

        // Build additionalSOLibSearchPath - include app bundle directory for component dylibs
        const soLibAppBundleDir = this.getAppBundleDirectory();
        const soLibFrameworkPath = this.getFrameworkPath();
        let soLibSearchPaths: string[] = [];
        if (this.mainAdditionalSOLibSearchPath) {
          soLibSearchPaths.push(this.mainAdditionalSOLibSearchPath);
        }
        if (soLibAppBundleDir) {
          soLibSearchPaths.push(soLibAppBundleDir);
        }
        if (soLibFrameworkPath) {
          soLibSearchPaths.push(soLibFrameworkPath);
        }
        const additionalSOLibSearchPath = soLibSearchPaths.length > 0 ? soLibSearchPaths.join(':') : undefined;

        const config: DebugConfiguration = {
          type: debuggerType,
          request: 'attach',
          name: `${childExecutableBasename} (PID: ${pid})`,
          processId: pid.toString(),
          stopAtConnect: false,
          targetArchitecture: targetArch,
          ...(miMode && { MIMode: miMode as 'gdb' | 'lldb' }),
          ...(programPathForSymbols && { program: programPathForSymbols }),
          ...(this.mainCwd && { cwd: this.mainCwd }),
          ...(this.mainMiDebuggerPath && { miDebuggerPath: this.mainMiDebuggerPath }),
          ...(setupCommands.length > 0 && { setupCommands }),
          ...(Object.keys(sourceFileMap).length > 0 && { sourceFileMap }),
          ...(this.mainSymbolSearchPath && { symbolSearchPath: this.mainSymbolSearchPath }),
          ...(additionalSOLibSearchPath && { additionalSOLibSearchPath })
        };

        this.logger.log(`Attach config for PID ${pid} (${childExecutableBasename}):`);
        this.logger.log(`  type: ${config.type}`);
        this.logger.log(`  MIMode: ${config.MIMode || 'not set'}`);
        this.logger.log(`  processId: ${config.processId}`);
        this.logger.log(`  program: ${config.program || 'not set'}`);
        if (programPathForSymbols !== childExecutablePath) {
          this.logger.log(`  (using main program for symbol loading, child executable: ${childExecutablePath})`);
        }
        this.logger.log(`  cwd: ${config.cwd || 'not set'}`);
        this.logger.log(`  setupCommands: ${config.setupCommands ? config.setupCommands.length + ' commands' : 'not set'}`);
        if (config.setupCommands && config.setupCommands.length > 0) {
          this.logger.log(`  setupCommands detail: ${JSON.stringify(config.setupCommands)}`);
        }
        this.logger.log(`  sourceFileMap: ${config.sourceFileMap ? JSON.stringify(config.sourceFileMap) : 'not set'}`);

        const success = await vscode.debug.startDebugging(undefined, config);
        if (success) {
          this.logger.log(`✓ Successfully initiated attach to PID ${pid}`);
          attached++;
        } else {
          this.processMonitor.untrackPid(pid);
          failed++;
          this.logger.log(`✗ Failed to initiate attach to PID ${pid}`);
        }

        // Small delay between attachments
        await this.delay(this.ATTACH_DELAY_MS);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.toLowerCase().includes('already') || errorMsg.toLowerCase().includes('attached')) {
          this.logger.log(`⚠ PID ${pid} already has debugger attached, marking as external`);
          this.processMonitor.trackPid(pid, 'external');
        } else {
          this.processMonitor.untrackPid(pid);
          this.logger.log(`✗ Failed to attach to PID ${pid}: ${errorMsg}`);
        }
        failed++;
      }
    }

    this.logger.log(`Attach round complete: ${attached} attached, ${failed} failed`);
    return { attached, failed };
  }

  /**
   * Attach to all processes (manual trigger)
   */
  async attachToAllProcesses(executableName?: string): Promise<AttachAllResult> {
    if (executableName) {
      this.processMonitor.setExecutableName(executableName);
    }

    const execName = this.processMonitor.getExecutableName();
    if (!execName) {
      this.logger.log('No executable name specified');
      return { total: 0, attached: 0, failed: 0 };
    }

    this.processMonitor.cleanupDeadProcesses();

    const pids = this.processMonitor.getProcessIds();
    const result = await this.attachToNewProcesses();

    return {
      total: pids.length,
      attached: result.attached,
      failed: result.failed
    };
  }

  /**
   * Start auto-attach monitoring
   */
  startAutoAttach(): void {
    if (this.autoAttachInterval) {
      return; // Already running
    }

    const execName = this.processMonitor.getExecutableName();
    this.logger.log(`Starting auto-attach monitor for ${execName || 'processes'}`);

    this.autoAttachInterval = setInterval(async () => {
      if (!this.isAutoAttachEnabled()) {
        return;
      }

      if (vscode.debug.activeDebugSession) {
        await this.attachToNewProcesses();
      }
    }, this.ATTACH_INTERVAL_MS);
  }

  /**
   * Stop auto-attach monitoring
   */
  stopAutoAttach(): void {
    if (this.autoAttachInterval) {
      clearInterval(this.autoAttachInterval);
      this.autoAttachInterval = null;
      this.logger.log('Stopped auto-attach monitor');
    }
  }

  /**
   * Handle extension activation with existing session
   */
  handleExistingSession(): void {
    if (!vscode.debug.activeDebugSession) {
      return;
    }

    const config = vscode.debug.activeDebugSession.configuration as DebugConfiguration;

    if (config.request === 'launch' && config.program) {
      const execName = ProcessMonitor.extractExecutableName(config.program, this.logger);
      this.processMonitor.setExecutableName(execName);
      this.mainLaunchSession = vscode.debug.activeDebugSession;
      // Store setupCommands and source-related settings for use in child attach configs
      this.mainSetupCommands = config.setupCommands;
      this.mainProgramPath = config.program;
      this.mainSourceFileMap = config.sourceFileMap;
      this.mainSymbolSearchPath = config.symbolSearchPath;
      this.mainAdditionalSOLibSearchPath = config.additionalSOLibSearchPath;
      this.mainCwd = config.cwd;
      this.mainMiDebuggerPath = config.miDebuggerPath;

      if (execName) {
        if (config.autoAttachChildProcesses === true) {
          this.logger.log(`Extension activated with existing launch session for ${execName}`);
          this.logger.log('autoAttachChildProcesses is enabled, starting auto-attach monitor');
          this.startAutoAttach();
        } else {
          this.logger.log(`Extension activated with existing launch session for ${execName}`);
          this.logger.log('autoAttachChildProcesses is not enabled in launch configuration');
        }
      }
    } else if (config.request === 'attach' && config.processId) {
      this.logger.log('Extension activated with existing attach session (use manual attach command if needed)');
    }
  }

  /**
   * Detect the main launched process PID
   * This is typically the first process with an exact basename match
   */
  private async detectMainLaunchedProcess(): Promise<void> {
    const execName = this.processMonitor.getExecutableName();
    if (!execName) {
      return;
    }

    const allPids = this.processMonitor.getProcessIds();
    if (allPids.length > 0) {
      // The first PID found is likely the main launched process
      // (VS Code launches the process, then child processes spawn)
      this.mainLaunchedPid = allPids[0];
      this.logger.log(`Detected main launched process PID: ${this.mainLaunchedPid} (excluding from auto-attach)`);
      // Track it so we don't try to attach to it
      this.processMonitor.trackPid(this.mainLaunchedPid, 'main-launched');
    }
  }

  /**
   * Stop all child debug sessions
   */
  private async stopAllChildSessions(): Promise<void> {
    const mainSessionId = this.mainLaunchSession?.id;
    const trackedPids = this.processMonitor.getTrackedPids();

    // Find all debug sessions that are child sessions (not the main one)
    const childSessions: vscode.DebugSession[] = [];
    for (const session of vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []) {
      if (session.id !== mainSessionId) {
        childSessions.push(session);
      }
    }

    // Also check all tracked PIDs for their session IDs
    for (const pid of trackedPids) {
      const sessionState = this.processMonitor.getSessionState(pid);
      // sessionState is the session ID when it's a valid session
      if (sessionState && sessionState !== 'attaching' && sessionState !== 'external' && sessionState !== 'main-launched') {
        // Find this session in active sessions - use debug.stopDebugging with undefined to stop all
        this.logger.log(`Stopping debug session for PID ${pid}`);
      }
    }

    // Stop all debug sessions except the one that triggered this (already stopped)
    // Using stopDebugging with undefined stops all sessions
    try {
      await vscode.debug.stopDebugging(undefined);
      this.logger.log('Stopped all debug sessions');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.log(`Error stopping debug sessions: ${errorMsg}`);
    }
  }

  /**
   * Check if breakpoint verification should be performed for auto-attached sessions.
   * Returns true if autoDetachIfNoBreakpoints is enabled (defaults to true when autoAttachChildProcesses is true).
   */
  private shouldVerifyBreakpoints(): boolean {
    if (!this.mainLaunchSession) {
      return false;
    }
    const config = this.mainLaunchSession.configuration as DebugConfiguration;
    // Default to true when autoAttachChildProcesses is enabled
    if (config.autoDetachIfNoBreakpoints === undefined) {
      return config.autoAttachChildProcesses === true;
    }
    return config.autoDetachIfNoBreakpoints === true;
  }

  /**
   * Get the breakpoint verification delay from configuration.
   */
  private getBreakpointVerificationDelay(): number {
    if (!this.mainLaunchSession) {
      return this.DEFAULT_BREAKPOINT_VERIFICATION_DELAY_MS;
    }
    const config = this.mainLaunchSession.configuration as DebugConfiguration;
    return config.breakpointVerificationDelayMs ?? this.DEFAULT_BREAKPOINT_VERIFICATION_DELAY_MS;
  }

  /**
   * Verify if any breakpoints are bound/verified in the given debug session.
   * Returns true if at least one breakpoint is verified in the session.
   */
  private async verifyBreakpointsInSession(session: vscode.DebugSession): Promise<boolean> {
    const allBreakpoints = vscode.debug.breakpoints;

    // Filter to source breakpoints only (FunctionBreakpoint doesn't have getDebugProtocolBreakpoint support)
    const sourceBreakpoints = allBreakpoints.filter(
      (bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint
    );

    if (sourceBreakpoints.length === 0) {
      this.logger.log(`No source breakpoints set, skipping verification for session ${session.name}`);
      return false;
    }

    this.logger.log(`Verifying ${sourceBreakpoints.length} breakpoint(s) in session ${session.name}...`);

    for (const breakpoint of sourceBreakpoints) {
      try {
        const debugProtocolBreakpoint = await session.getDebugProtocolBreakpoint(breakpoint);
        // DebugProtocolBreakpoint is an opaque type in VS Code, but at runtime it contains
        // the DAP Breakpoint properties including 'verified'. Cast to access it.
        const bpWithVerified = debugProtocolBreakpoint as { verified?: boolean } | undefined;
        if (bpWithVerified?.verified) {
          const location = breakpoint.location;
          this.logger.log(`✓ Verified breakpoint at ${location.uri.fsPath}:${location.range.start.line + 1} in session ${session.name}`);
          return true;
        }
      } catch {
        // getDebugProtocolBreakpoint may throw if session doesn't support it or breakpoint isn't known
        continue;
      }
    }

    this.logger.log(`No verified breakpoints found in session ${session.name}`);
    return false;
  }

  /**
   * Schedule breakpoint verification for an auto-attached session.
   * After a configurable delay, checks if any breakpoints are verified.
   * If no breakpoints are verified, detaches from the session.
   */
  private scheduleBreakpointVerification(session: vscode.DebugSession): void {
    const pid = DebugSessionManager.getPidFromSession(session);
    const delay = this.getBreakpointVerificationDelay();

    this.logger.log(`Scheduling breakpoint verification for session ${session.name} (PID ${pid}) in ${delay}ms`);

    const timeout = setTimeout(async () => {
      // Remove from pending map
      this.pendingVerification.delete(session.id);

      // Check if session is still active
      const isActive = vscode.debug.activeDebugSession?.id === session.id ||
        Array.from(vscode.debug.breakpoints).length >= 0; // Just check session exists by trying to use it

      try {
        const hasVerifiedBreakpoints = await this.verifyBreakpointsInSession(session);

        if (!hasVerifiedBreakpoints) {
          this.logger.log(`No verified breakpoints in session ${session.name} (PID ${pid}), detaching...`);

          // Track PID as detached to prevent re-attachment
          if (pid) {
            this.detachedPids.add(pid);
            this.logger.log(`Added PID ${pid} to detached PIDs set (will not re-attach)`);
          }

          // Detach from the session
          try {
            await vscode.debug.stopDebugging(session);
            this.logger.log(`✓ Detached from session ${session.name} (PID ${pid})`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger.log(`Failed to detach from session ${session.name}: ${errorMsg}`);
          }
        } else {
          this.logger.log(`✓ Session ${session.name} (PID ${pid}) has verified breakpoints, keeping attached`);
        }
      } catch (error) {
        // Session may have already terminated
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.log(`Breakpoint verification failed for session ${session.name}: ${errorMsg}`);
      }
    }, delay);

    this.pendingVerification.set(session.id, timeout);
  }

  /**
   * Cancel pending breakpoint verification for a session.
   */
  private cancelPendingVerification(sessionId: string): void {
    const timeout = this.pendingVerification.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingVerification.delete(sessionId);
      this.logger.log(`Cancelled pending breakpoint verification for session ${sessionId}`);
    }
  }

  /**
   * Clean up all state
   */
  cleanup(): void {
    this.mainLaunchSession = null;
    this.mainSetupCommands = undefined;
    this.mainProgramPath = undefined;
    this.mainSourceFileMap = undefined;
    this.mainSymbolSearchPath = undefined;
    this.mainAdditionalSOLibSearchPath = undefined;
    this.mainCwd = undefined;
    this.mainMiDebuggerPath = undefined;
    this.mainLaunchedPid = null;
    this.processMonitor.clear();
    this.stopAutoAttach();

    // Clear breakpoint verification state
    for (const timeout of this.pendingVerification.values()) {
      clearTimeout(timeout);
    }
    this.pendingVerification.clear();
    this.detachedPids.clear();
  }

  /**
   * Utility function to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Determine the program path to use for symbol loading based on the child process type.
   * Uses the child executable path when available and valid.
   */
  private getProgramPathForSymbolLoading(childExecutablePath: string | undefined): string | undefined {
    // Use child executable path if it's a full path and exists on disk
    if (childExecutablePath && (childExecutablePath.includes('/') || childExecutablePath.includes('\\'))) {
      if (fs.existsSync(childExecutablePath)) {
        return childExecutablePath;
      }
      this.logger.log(`Warning: Child executable path does not exist, skipping symbol loading: ${childExecutablePath}`);
    }
    return undefined;
  }

  /**
   * Get the directory containing the .app bundle (where dylibs/symbols are located).
   */
  private getAppBundleDirectory(): string | undefined {
    if (!this.mainProgramPath) {
      return undefined;
    }

    // Extract directory containing the .app bundle
    // e.g., /path/to/out/Component_arm64/App.app/Contents/MacOS/App -> /path/to/out/Component_arm64
    const appMatch = this.mainProgramPath.match(/^(.+)\/[^/]+\.app\//);
    if (appMatch) {
      return appMatch[1];
    }

    return path.dirname(this.mainProgramPath);
  }

  /**
   * Get the Framework directory path for macOS app bundles.
   *
   * For Chromium-based apps on macOS, the Framework directory contains the main
   * dylib with all the symbols. Path structure:
   * AppName.app/Contents/Frameworks/AppName Framework.framework/Versions/X/AppName Framework
   *
   * Helper processes are located inside the Framework:
   * AppName.app/Contents/Frameworks/AppName Framework.framework/Versions/X/Helpers/
   */
  private getFrameworkPath(): string | undefined {
    if (!PlatformUtils.isMacOS()) {
      return undefined;
    }

    // Try to find Framework path from mainProgramPath
    if (this.mainProgramPath) {
      // Check if this is a macOS .app bundle
      const appMatch = this.mainProgramPath.match(/^(.+\.app)\/Contents\/MacOS\/(.+)$/);
      if (appMatch) {
        const appBundlePath = appMatch[1];
        const executableName = appMatch[2];

        // The Framework is typically named "AppName Framework.framework"
        // Located at AppName.app/Contents/Frameworks/
        const frameworksDir = path.join(appBundlePath, 'Contents', 'Frameworks');
        const frameworkName = `${executableName} Framework.framework`;
        const frameworkPath = path.join(frameworksDir, frameworkName);

        this.logger.log(`Detected Framework path from main app: ${frameworkPath}`);
        return frameworkPath;
      }
    }

    return undefined;
  }
}
