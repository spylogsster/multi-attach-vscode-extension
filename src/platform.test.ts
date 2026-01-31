/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as os from 'os';
import { Platform, PlatformUtils } from './platform';

jest.mock('os');

describe('PlatformUtils', () => {
  const mockPlatform = os.platform as jest.MockedFunction<typeof os.platform>;

  beforeEach(() => {
    // Reset the cached platform
    (PlatformUtils as any).currentPlatform = null;
  });

  describe('getPlatform', () => {
    it('should return Windows for win32', () => {
      mockPlatform.mockReturnValue('win32');
      expect(PlatformUtils.getPlatform()).toBe(Platform.Windows);
    });

    it('should return MacOS for darwin', () => {
      mockPlatform.mockReturnValue('darwin');
      expect(PlatformUtils.getPlatform()).toBe(Platform.MacOS);
    });

    it('should return Linux for linux', () => {
      mockPlatform.mockReturnValue('linux');
      expect(PlatformUtils.getPlatform()).toBe(Platform.Linux);
    });

    it('should return Unsupported for unknown platform', () => {
      mockPlatform.mockReturnValue('unknown' as any);
      expect(PlatformUtils.getPlatform()).toBe(Platform.Unsupported);
    });

    it('should cache the platform result', () => {
      // Reset cache
      (PlatformUtils as any).currentPlatform = null;
      mockPlatform.mockClear();

      mockPlatform.mockReturnValue('win32');
      PlatformUtils.getPlatform();
      PlatformUtils.getPlatform();

      expect(mockPlatform).toHaveBeenCalledTimes(1);
    });
  });

  describe('isWindows', () => {
    it('should return true for Windows platform', () => {
      mockPlatform.mockReturnValue('win32');
      expect(PlatformUtils.isWindows()).toBe(true);
    });

    it('should return false for non-Windows platform', () => {
      mockPlatform.mockReturnValue('darwin');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.isWindows()).toBe(false);
    });
  });

  describe('isMacOS', () => {
    it('should return true for macOS platform', () => {
      mockPlatform.mockReturnValue('darwin');
      expect(PlatformUtils.isMacOS()).toBe(true);
    });

    it('should return false for non-macOS platform', () => {
      mockPlatform.mockReturnValue('win32');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.isMacOS()).toBe(false);
    });
  });

  describe('isLinux', () => {
    it('should return true for Linux platform', () => {
      mockPlatform.mockReturnValue('linux');
      expect(PlatformUtils.isLinux()).toBe(true);
    });

    it('should return false for non-Linux platform', () => {
      mockPlatform.mockReturnValue('win32');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.isLinux()).toBe(false);
    });
  });

  describe('getDebuggerType', () => {
    it('should return cppvsdbg for Windows', () => {
      mockPlatform.mockReturnValue('win32');
      expect(PlatformUtils.getDebuggerType()).toBe('cppvsdbg');
    });

    it('should return cppdbg for macOS', () => {
      mockPlatform.mockReturnValue('darwin');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.getDebuggerType()).toBe('cppdbg');
    });

    it('should return cppdbg for Linux', () => {
      mockPlatform.mockReturnValue('linux');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.getDebuggerType()).toBe('cppdbg');
    });

    it('should return cppdbg for unsupported platform', () => {
      mockPlatform.mockReturnValue('unknown' as any);
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.getDebuggerType()).toBe('cppdbg');
    });
  });

  describe('getMIMode', () => {
    it('should return undefined for Windows', () => {
      mockPlatform.mockReturnValue('win32');
      expect(PlatformUtils.getMIMode()).toBeUndefined();
    });

    it('should return lldb for macOS', () => {
      mockPlatform.mockReturnValue('darwin');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.getMIMode()).toBe('lldb');
    });

    it('should return gdb for Linux', () => {
      mockPlatform.mockReturnValue('linux');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.getMIMode()).toBe('gdb');
    });

    it('should return undefined for unsupported platform', () => {
      mockPlatform.mockReturnValue('unknown' as any);
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.getMIMode()).toBeUndefined();
    });
  });

  describe('getExecutableExtension', () => {
    it('should return .exe for Windows', () => {
      mockPlatform.mockReturnValue('win32');
      expect(PlatformUtils.getExecutableExtension()).toBe('.exe');
    });

    it('should return empty string for macOS', () => {
      mockPlatform.mockReturnValue('darwin');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.getExecutableExtension()).toBe('');
    });

    it('should return empty string for Linux', () => {
      mockPlatform.mockReturnValue('linux');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.getExecutableExtension()).toBe('');
    });
  });

  describe('normalizeExecutableName', () => {
    it('should add .exe extension on Windows', () => {
      mockPlatform.mockReturnValue('win32');
      expect(PlatformUtils.normalizeExecutableName('myapp')).toBe('myapp.exe');
    });

    it('should keep .exe extension on Windows', () => {
      mockPlatform.mockReturnValue('win32');
      expect(PlatformUtils.normalizeExecutableName('myapp.exe')).toBe('myapp.exe');
    });

    it('should remove .exe extension on macOS', () => {
      mockPlatform.mockReturnValue('darwin');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.normalizeExecutableName('myapp.exe')).toBe('myapp');
    });

    it('should keep name without extension on macOS', () => {
      mockPlatform.mockReturnValue('darwin');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.normalizeExecutableName('myapp')).toBe('myapp');
    });

    it('should remove .exe extension on Linux', () => {
      mockPlatform.mockReturnValue('linux');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.normalizeExecutableName('myapp.exe')).toBe('myapp');
    });

    it('should keep name without extension on Linux', () => {
      mockPlatform.mockReturnValue('linux');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.normalizeExecutableName('myapp')).toBe('myapp');
    });

    it('should handle case-insensitive .exe on Unix', () => {
      mockPlatform.mockReturnValue('darwin');
      (PlatformUtils as any).currentPlatform = null;
      expect(PlatformUtils.normalizeExecutableName('myapp.EXE')).toBe('myapp');
    });
  });
});
