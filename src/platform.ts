/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as os from 'os';

/**
 * Supported platforms
 */
export enum Platform {
  Windows = 'windows',
  MacOS = 'macos',
  Linux = 'linux',
  Unsupported = 'unsupported'
}

/**
 * Platform-specific utilities
 */
export class PlatformUtils {
  private static currentPlatform: Platform | null = null;

  /**
   * Get the current platform
   */
  static getPlatform(): Platform {
    if (this.currentPlatform) {
      return this.currentPlatform;
    }

    const platform = os.platform();

    switch (platform) {
      case 'win32':
        this.currentPlatform = Platform.Windows;
        break;
      case 'darwin':
        this.currentPlatform = Platform.MacOS;
        break;
      case 'linux':
        this.currentPlatform = Platform.Linux;
        break;
      default:
        this.currentPlatform = Platform.Unsupported;
    }

    return this.currentPlatform;
  }

  /**
   * Check if running on Windows
   */
  static isWindows(): boolean {
    return this.getPlatform() === Platform.Windows;
  }

  /**
   * Check if running on macOS
   */
  static isMacOS(): boolean {
    return this.getPlatform() === Platform.MacOS;
  }

  /**
   * Check if running on Linux
   */
  static isLinux(): boolean {
    return this.getPlatform() === Platform.Linux;
  }

  /**
   * Get the debugger type for the current platform
   */
  static getDebuggerType(): string {
    switch (this.getPlatform()) {
      case Platform.Windows:
        return 'cppvsdbg';
      case Platform.MacOS:
      case Platform.Linux:
        return 'cppdbg';
      default:
        return 'cppdbg';
    }
  }

  /**
   * Get the MIMode for the current platform (used with cppdbg)
   */
  static getMIMode(): string | undefined {
    switch (this.getPlatform()) {
      case Platform.MacOS:
        return 'lldb';
      case Platform.Linux:
        return 'gdb';
      case Platform.Windows:
        return undefined; // cppvsdbg doesn't use MIMode
      default:
        return undefined;
    }
  }

  /**
   * Get the executable extension for the current platform
   */
  static getExecutableExtension(): string {
    return this.isWindows() ? '.exe' : '';
  }

  /**
   * Normalize executable name for the current platform
   */
  static normalizeExecutableName(name: string): string {
    if (this.isWindows()) {
      // On Windows, ensure .exe extension
      return name.endsWith('.exe') ? name : name + '.exe';
    } else {
      // On Unix-like systems, remove .exe if present
      return name.replace(/\.exe$/i, '');
    }
  }

  /**
   * Get the target architecture for the debugger
   */
  static getTargetArchitecture(): string {
    const arch = os.arch();
    switch (arch) {
      case 'arm64':
        return 'arm64';
      case 'x64':
        return 'x86_64';
      case 'ia32':
        return 'x86';
      default:
        return arch;
    }
  }
}
