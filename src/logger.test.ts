/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Logger } from './logger';
import * as vscode from 'vscode';

describe('Logger', () => {
  const mockAppendLine = jest.fn();
  const mockShow = jest.fn();
  const mockDispose = jest.fn();
  let logger: Logger;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    // Setup mock functions
    (vscode.window.createOutputChannel as jest.Mock).mockReturnValue({
      appendLine: mockAppendLine,
      show: mockShow,
      dispose: mockDispose
    });

    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('initialize', () => {
    it('should create and show output channel', () => {
      logger.initialize('Test Channel');

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Test Channel');
      expect(mockShow).toHaveBeenCalled();
    });
  });

  describe('log', () => {
    it('should log message to output channel with timestamp', () => {
      logger.initialize('Test Channel');
      logger.log('Test message');

      expect(mockAppendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{1,2}:\d{2}:\d{2}( (AM|PM))?\] Test message/)
      );
    });

    it('should log to console even without output channel', () => {
      logger.log('Test message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{1,2}:\d{2}:\d{2}( (AM|PM))?\] Test message/)
      );
    });

    it('should handle disposed output channel gracefully', () => {
      logger.initialize('Test Channel');
      mockAppendLine.mockImplementation(() => {
        throw new Error('Disposed');
      });

      expect(() => logger.log('Test message')).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('separator', () => {
    it('should log a separator line', () => {
      logger.initialize('Test Channel');
      logger.separator();

      expect(mockAppendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{1,2}:\d{2}:\d{2}( (AM|PM))?\] ========================================/)
      );
    });
  });

  describe('dispose', () => {
    it('should dispose output channel', () => {
      logger.initialize('Test Channel');
      logger.dispose();

      expect(mockDispose).toHaveBeenCalled();
    });

    it('should handle multiple dispose calls', () => {
      logger.initialize('Test Channel');
      logger.dispose();
      logger.dispose();

      expect(mockDispose).toHaveBeenCalledTimes(1);
    });

    it('should not throw when disposing without initialization', () => {
      expect(() => logger.dispose()).not.toThrow();
    });
  });
});
