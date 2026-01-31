/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';
import { Logger } from './logger';
import { ProcessMonitor } from './processMonitor';
import { DebugSessionManager } from './debugSessionManager';
import { DebugConfiguration } from './types';
import { PlatformUtils } from './platform';

let logger: Logger;
let processMonitor: ProcessMonitor;
let debugSessionManager: DebugSessionManager;

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  // Initialize components
  logger = new Logger();
  logger.initialize('App Debug Helper');

  logger.separator();
  logger.log('App Debug Helper extension ACTIVATED');
  logger.log(`Platform: ${PlatformUtils.getPlatform()}`);
  logger.log(`Debugger: ${PlatformUtils.getDebuggerType()}${PlatformUtils.getMIMode() ? ` (MIMode: ${PlatformUtils.getMIMode()})` : ''}`);
  logger.separator();

  processMonitor = new ProcessMonitor(logger);
  debugSessionManager = new DebugSessionManager(logger, processMonitor);

  // Register command: Attach to All Processes
  const attachAllCommand = vscode.commands.registerCommand('app-debug.attachAll', async () => {
    try {
      let execName = processMonitor.getExecutableName();

      // Try to get executable name from active debug session
      if (!execName && vscode.debug.activeDebugSession) {
        const config = vscode.debug.activeDebugSession.configuration as DebugConfiguration;
        if (config.program) {
          execName = ProcessMonitor.extractExecutableName(config.program, logger);
        }
      }

      if (!execName) {
        vscode.window.showErrorMessage('Error attaching to processes: Executable name not specified');
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Attaching to ${execName} processes`,
          cancellable: false
        },
        async (progress) => {
          progress.report({ message: `Scanning for ${execName} processes...` });

          const pids = processMonitor.getProcessIds();

          if (pids.length === 0) {
            vscode.window.showWarningMessage(
              `No ${execName} processes found. Please start the application first.`
            );
            return;
          }

          progress.report({
            message: `Found ${pids.length} process(es), attaching...`,
            increment: 10
          });

          const result = await debugSessionManager.attachToAllProcesses(execName);

          if (result.attached === result.total) {
            vscode.window.showInformationMessage(
              `Successfully attached debugger to all ${result.attached} ${execName} process(es)`
            );
          } else if (result.attached > 0) {
            vscode.window.showWarningMessage(
              `Attached to ${result.attached} of ${result.total} processes (${result.failed} failed)`
            );
          } else {
            vscode.window.showErrorMessage(`Failed to attach to any ${execName} processes`);
          }
        }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Error attaching to processes: ${errorMsg}`);
    }
  });

  // Listen for debug session start events
  const debugStartListener = vscode.debug.onDidStartDebugSession(async (session) => {
    await debugSessionManager.onDebugSessionStarted(session);
  });

  // Listen for debug session termination
  const debugStopListener = vscode.debug.onDidTerminateDebugSession(async (session) => {
    await debugSessionManager.onDebugSessionTerminated(session);
  });

  // Handle existing debug session on activation
  debugSessionManager.handleExistingSession();

  // Register disposables
  context.subscriptions.push(
    attachAllCommand,
    debugStartListener,
    debugStopListener
  );
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  logger.log('App Debug Helper extension deactivating...');

  if (debugSessionManager) {
    debugSessionManager.cleanup();
  }

  if (logger) {
    logger.dispose();
  }
}
