/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Mock vscode module for testing
export const window = {
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn()
  })),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showInformationMessage: jest.fn(),
  withProgress: jest.fn((options, task) => task({ report: jest.fn() }))
};

export const debug = {
  startDebugging: jest.fn(),
  stopDebugging: jest.fn(),
  activeDebugSession: undefined as DebugSession | undefined,
  breakpoints: [] as Breakpoint[],
  onDidStartDebugSession: jest.fn(),
  onDidTerminateDebugSession: jest.fn()
};

// Mock SourceBreakpoint class
export class SourceBreakpoint {
  readonly enabled: boolean;
  readonly condition?: string;
  readonly hitCondition?: string;
  readonly logMessage?: string;
  readonly location: Location;

  constructor(location: Location, enabled = true) {
    this.location = location;
    this.enabled = enabled;
  }
}

// Mock FunctionBreakpoint class
export class FunctionBreakpoint {
  readonly enabled: boolean;
  readonly functionName: string;

  constructor(functionName: string, enabled = true) {
    this.functionName = functionName;
    this.enabled = enabled;
  }
}

// Mock Location interface
export interface Location {
  uri: Uri;
  range: Range;
}

// Mock Uri
export class Uri {
  readonly fsPath: string;
  readonly scheme: string;

  private constructor(fsPath: string, scheme = 'file') {
    this.fsPath = fsPath;
    this.scheme = scheme;
  }

  static file(path: string): Uri {
    return new Uri(path);
  }
}

// Mock Range
export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }
}

// Mock Position
export class Position {
  readonly line: number;
  readonly character: number;

  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

// Base Breakpoint type
export type Breakpoint = SourceBreakpoint | FunctionBreakpoint;

export const commands = {
  registerCommand: jest.fn()
};

export enum ProgressLocation {
  Notification = 15
}

// Mock types - these are just placeholders for TypeScript
export interface DebugSession {
  id: string;
  type: string;
  name: string;
  workspaceFolder: any;
  configuration: any;
  customRequest(command: string, args?: any): Promise<any>;
  getDebugProtocolBreakpoint(breakpoint: any): Promise<any>;
}

export interface DebugConfiguration {
  type: string;
  name: string;
  request: string;
  [key: string]: any;
}

export interface OutputChannel {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

export interface ExtensionContext {
  subscriptions: any[];
  [key: string]: any;
}
