/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as vscode from 'vscode';

/**
 * Handles logging to the output channel
 */
export class Logger {
  private outputChannel: vscode.OutputChannel | null = null;

  /**
   * Initialize the logger with an output channel
   */
  initialize(channelName: string): void {
    this.outputChannel = vscode.window.createOutputChannel(channelName);
    this.outputChannel.show();
  }

  /**
   * Log a message to the output channel
   */
  log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] ${message}`;

    try {
      if (this.outputChannel) {
        this.outputChannel.appendLine(formattedMessage);
      }
    } catch (error) {
      // Silently ignore errors if output channel is disposed
    }

    console.log(formattedMessage);
  }

  /**
   * Log a separator line for visual organization
   */
  separator(): void {
    this.log('========================================');
  }

  /**
   * Dispose of the output channel
   */
  dispose(): void {
    if (this.outputChannel) {
      this.outputChannel.dispose();
      this.outputChannel = null;
    }
  }
}
