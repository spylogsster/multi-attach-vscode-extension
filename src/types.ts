/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

/**
 * Represents the result of an attach operation
 */
export interface AttachResult {
  attached: number;
  failed: number;
}

/**
 * Represents the result of attaching to all processes
 */
export interface AttachAllResult extends AttachResult {
  total: number;
}

/**
 * Possible session states for tracked PIDs
 */
export type SessionState = string | 'attaching' | 'external';

/**
 * Information about a detected process
 */
export interface ProcessInfo {
  pid: number;
  executablePath: string;
}

/**
 * Setup command for debugger initialization
 */
export interface SetupCommand {
  description?: string;
  text: string;
  ignoreFailures?: boolean;
}

/**
 * Configuration interface for debug configurations
 */
export interface DebugConfiguration extends vscode.DebugConfiguration {
  program?: string;
  processId?: string;
  autoAttachChildProcesses?: boolean;
  autoDetachIfNoBreakpoints?: boolean;  // Default: true when autoAttachChildProcesses is true
  breakpointVerificationDelayMs?: number;  // Default: 3000ms
  MIMode?: 'gdb' | 'lldb';
  setupCommands?: SetupCommand[];
  sourceFileMap?: Record<string, string>;
  symbolSearchPath?: string;
  additionalSOLibSearchPath?: string;
  cwd?: string;
  miDebuggerPath?: string;
  stopAtConnect?: boolean;
  targetArchitecture?: string;
}
