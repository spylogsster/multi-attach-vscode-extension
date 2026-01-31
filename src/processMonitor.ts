/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { execSync } from 'child_process';
import * as path from 'path';
import { Logger } from './logger';
import { SessionState, ProcessInfo } from './types';
import { PlatformUtils } from './platform';

/**
 * Monitors and manages application processes
 */
export class ProcessMonitor {
  private attachedPids: Map<number, SessionState> = new Map();
  private processExecutablePaths: Map<number, string> = new Map();
  private currentExecutableName: string | null = null;
  private lastDetectedPids: number[] = [];

  constructor(private logger: Logger) {}

  /**
   * Set the executable name to monitor
   */
  setExecutableName(executableName: string | null): void {
    this.currentExecutableName = executableName;
  }

  /**
   * Get the current executable name
   */
  getExecutableName(): string | null {
    return this.currentExecutableName;
  }

  /**
   * Extract executable name from a program path
   */
  static extractExecutableName(programPath: string, logger?: Logger): string | null {
    if (!programPath) {
      logger?.log('extractExecutableName: empty programPath');
      return null;
    }
    const basename = path.basename(programPath);
    const normalized = PlatformUtils.normalizeExecutableName(basename);
    logger?.log(`extractExecutableName: programPath="${programPath}" -> basename="${basename}" -> normalized="${normalized}"`);
    return normalized;
  }

  /**
   * Get all process IDs for the current executable
   */
  getProcessIds(): number[] {
    if (!this.currentExecutableName) {
      this.logger.log('No executable name provided, skipping process detection');
      return [];
    }

    if (PlatformUtils.isWindows()) {
      return this.getProcessIdsWindows();
    } else {
      return this.getProcessIdsUnix();
    }
  }

  /**
   * Get process IDs on Windows using tasklist
   */
  private getProcessIdsWindows(): number[] {
    const sanitizedName = this.sanitizeExecutableName(this.currentExecutableName!);
    if (sanitizedName !== this.currentExecutableName) {
      this.logger.log(`Warning: Executable name contains invalid characters, sanitized to: ${sanitizedName}`);
    }

    try {
      const output = execSync(`tasklist /FI "IMAGENAME eq ${sanitizedName}" /FO CSV /NH`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });

      const pids: number[] = [];
      const lines = output.trim().split('\n');

      for (const line of lines) {
        if (line.includes(sanitizedName)) {
          const match = line.match(/"([^"]+)","(\d+)"/);
          if (match) {
            const imageName = match[1];
            const pid = parseInt(match[2]);
            pids.push(pid);
            // Store the executable name for this PID (Windows doesn't give full path from tasklist)
            this.processExecutablePaths.set(pid, imageName);
          }
        }
      }

      return pids;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.log(`Error getting ${sanitizedName} processes: ${errorMsg}`);
      return [];
    }
  }

  /**
   * Get process IDs on Unix-like systems using ps
   */
  private getProcessIdsUnix(): number[] {
    const sanitizedName = this.sanitizeExecutableName(this.currentExecutableName!);
    if (sanitizedName !== this.currentExecutableName) {
      this.logger.log(`Warning: Executable name contains invalid characters, sanitized to: ${sanitizedName}`);
    }

    try {
      // Use ps to list all processes with their PIDs and command names
      const output = execSync('ps -A -o pid,comm', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });

      const pids: number[] = [];
      const lines = output.trim().split('\n');

      for (const line of lines) {
        const trimmedLine = line.trim();
        // Handle multi-word command names by only splitting on first whitespace
        const firstSpaceIdx = trimmedLine.indexOf(' ');
        if (firstSpaceIdx === -1) continue;

        const pidStr = trimmedLine.substring(0, firstSpaceIdx).trim();
        const command = trimmedLine.substring(firstSpaceIdx + 1).trim();
        const pid = parseInt(pidStr);

        // Match either the full command name or just the basename
        const commandBasename = path.basename(command);

        const basenameMatch = commandBasename === sanitizedName;
        const includesMatch = command.includes(sanitizedName);

        if (basenameMatch || includesMatch) {
          if (!isNaN(pid)) {
            pids.push(pid);
            // Store the executable path for this PID
            this.processExecutablePaths.set(pid, command);
          }
        }
      }

      // Only log when process list changes
      const pidsChanged = !this.arraysEqual(pids, this.lastDetectedPids);
      if (pidsChanged) {
        const newPids = pids.filter(p => !this.lastDetectedPids.includes(p));
        const removedPids = this.lastDetectedPids.filter(p => !pids.includes(p));

        if (newPids.length > 0) {
          this.logger.log(`Detected ${newPids.length} new process(es): [${newPids.join(', ')}]`);
          // Log details for new processes only
          for (const pid of newPids) {
            const command = this.processExecutablePaths.get(pid);
            if (command) {
              this.logger.log(`  PID ${pid}: ${path.basename(command)}`);
            }
          }
        }
        if (removedPids.length > 0) {
          this.logger.log(`${removedPids.length} process(es) exited: [${removedPids.join(', ')}]`);
        }

        this.lastDetectedPids = [...pids];
      }

      if (pids.length === 0 && this.lastDetectedPids.length === 0) {
        // Only log "no matches" once when we first start looking
        if (this.lastDetectedPids.length === 0) {
          // Already logged or will be logged by caller
        }
      }

      return pids;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.log(`Error getting ${sanitizedName} processes: ${errorMsg}`);
      return [];
    }
  }

  /**
   * Helper to compare two arrays for equality
   */
  private arraysEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort((x, y) => x - y);
    const sortedB = [...b].sort((x, y) => x - y);
    return sortedA.every((val, idx) => val === sortedB[idx]);
  }

  /**
   * Get the executable path for a specific PID
   */
  getExecutablePath(pid: number): string | undefined {
    return this.processExecutablePaths.get(pid);
  }

  /**
   * Check if a process is still running
   */
  isProcessRunning(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
      this.logger.log(`Warning: Invalid PID ${pid}`);
      return false;
    }

    if (PlatformUtils.isWindows()) {
      return this.isProcessRunningWindows(pid);
    } else {
      return this.isProcessRunningUnix(pid);
    }
  }

  /**
   * Check if a process is running on Windows
   */
  private isProcessRunningWindows(pid: number): boolean {
    try {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      return output.includes(`"${pid}"`);
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a process is running on Unix-like systems
   */
  private isProcessRunningUnix(pid: number): boolean {
    try {
      // Using kill -0 is a standard way to check if a process exists
      execSync(`kill -0 ${pid}`, {
        stdio: 'ignore'
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a process already has a debugger attached
   */
  isDebuggerAttached(pid: number): boolean {
    return this.attachedPids.has(pid);
  }

  /**
   * Track a PID with its session state
   */
  trackPid(pid: number, state: SessionState): void {
    this.attachedPids.set(pid, state);
  }

  /**
   * Untrack a PID
   */
  untrackPid(pid: number): void {
    this.attachedPids.delete(pid);
  }

  /**
   * Get the session state for a PID
   */
  getSessionState(pid: number): SessionState | undefined {
    return this.attachedPids.get(pid);
  }

  /**
   * Get all tracked PIDs
   */
  getTrackedPids(): number[] {
    return Array.from(this.attachedPids.keys());
  }

  /**
   * Clean up dead processes from the tracked list
   */
  cleanupDeadProcesses(): number {
    const deadPids: number[] = [];

    for (const [pid] of this.attachedPids.entries()) {
      if (!this.isProcessRunning(pid)) {
        deadPids.push(pid);
        this.logger.log(`Process ${pid} is no longer running, removing from tracked list`);
      }
    }

    deadPids.forEach(pid => this.attachedPids.delete(pid));
    return deadPids.length;
  }

  /**
   * Clear all tracked PIDs
   */
  clear(): void {
    this.attachedPids.clear();
    this.processExecutablePaths.clear();
    this.currentExecutableName = null;
    this.lastDetectedPids = [];
  }

  /**
   * Sanitize executable name to prevent command injection
   * Allows spaces since they are common in macOS app names
   */
  private sanitizeExecutableName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._\- ]/g, '');
  }
}
