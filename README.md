# App Debug Helper Extension

This VSCode extension automatically attaches the debugger to all application processes with smart breakpoint filtering. The extension keeps debugger attached only to processes that have loaded sources with active breakpoints (detaches from processes without relevant breakpoints to reduce overhead).

Tested and optimized for Chromium browser development, where multi-process architecture requires debugging multiple child processes (renderer, GPU, utility, etc.).

## Features

- **Cross-platform**: Works on Windows, macOS, and Linux
- **Auto-attach**: Automatically detects and attaches to new application processes when you start debugging
- **Smart breakpoint filtering**: Only keeps debugger attached to processes that have loaded sources with active breakpoints (detaches from processes without relevant breakpoints to reduce overhead)
- **No reload needed**: Works without reloading the VSCode window
- **Background monitoring**: Continuously monitors for new child processes every 2 seconds
- **Manual trigger**: Attach to all processes on demand with a command
- **Dynamic executable detection**: Automatically detects the executable name from your debug configuration
- **Platform-aware debugger**: Automatically uses the correct debugger (cppvsdbg on Windows, cppdbg with lldb on macOS, cppdbg with gdb on Linux)

## Development

### Running Tests

The extension includes comprehensive unit tests for all components:

```bash
# Run all tests
npm run tests

# Run tests in watch mode
npm run tests:watch

# Run tests with coverage report
npm run tests:coverage
```

Test coverage includes:
- **Logger** - Output channel management and logging
- **PlatformUtils** - Cross-platform detection and configuration
- **ProcessMonitor** - Process detection and tracking on Windows/macOS/Linux
- **DebugSessionManager** - Debug session lifecycle and auto-attach logic

### Building

```bash
# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Package the extension
npm run package
```

## Installation (One-time setup)

### Quick Install

1. Open a terminal in the `vscode/extension` folder
2. Run one of the following:
   - Windows: `install.bat`
   - Cross-platform: `npm run package`
3. Follow the prompts to package the extension
4. In VSCode:
   - Press `Ctrl+Shift+X` (Extensions view)
   - Click the `...` menu → "Install from VSIX..."
   - Select `app-debug-helper-1.5.0.vsix` from the extension folder
5. Reload VSCode

### Manual Install

```bash
npm install -g @vscode/vsce
vsce package --allow-missing-repository
```

Then install the generated `.vsix` file via VSCode Extensions menu.

## How to Use

### Automatic Mode (Recommended)

1. Add `"autoAttachChildProcesses": true` to your launch configuration in `.vscode/launch.json`:

**Windows:**
```json
{
  "type": "cppvsdbg",
  "request": "launch",
  "name": "Launch App",
  "program": "${workspaceFolder}/path/to/your/app.exe",
  "autoAttachChildProcesses": true
}
```

**macOS:**
```json
{
  "type": "cppdbg",
  "request": "launch",
  "name": "Launch App",
  "program": "${workspaceFolder}/path/to/your/app",
  "MIMode": "lldb",
  "autoAttachChildProcesses": true
}
```

**Linux:**
```json
{
  "type": "cppdbg",
  "request": "launch",
  "name": "Launch App",
  "program": "${workspaceFolder}/path/to/your/app",
  "MIMode": "gdb",
  "autoAttachChildProcesses": true
}
```

2. Start debugging by pressing `F5`
3. The extension will automatically:
   - Detect the main application process
   - Monitor for new child processes
   - Attach the debugger to each new process automatically (every 2 seconds)
   - No window reload needed!

### Manual Mode

Use the Command Palette (`Ctrl+Shift+P`) and run:
- **"App Debug: Attach to All Processes"** - Attach to all currently running processes

## How It Works

1. When you start a debug session with `autoAttachChildProcesses: true`, the extension activates
2. It detects your platform and configures the appropriate debugger:
   - **Windows**: Uses `cppvsdbg` debugger with `tasklist` for process detection
   - **macOS**: Uses `cppdbg` debugger with `MIMode: lldb` and `ps` for process detection
   - **Linux**: Uses `cppdbg` debugger with `MIMode: gdb` and `ps` for process detection
3. It extracts the executable name from your debug configuration's "program" parameter
4. It begins monitoring for processes matching that executable every 2 seconds
5. When new processes are detected, it automatically attaches the debugger with the correct configuration
6. Tracks which processes are already attached to avoid duplicates
7. Cleans up when all debug sessions end

**Note:** If `autoAttachChildProcesses` is not set to `true` in your launch configuration, auto-attach will not activate. You can still use the manual "Attach to All Processes" command.

## Configuration Options

The following options can be added to your launch configuration in `.vscode/launch.json`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoAttachChildProcesses` | `boolean` | `false` | Enable automatic attachment to child processes. When `true`, the extension monitors for new processes matching the executable name and attaches the debugger automatically. |
| `autoDetachIfNoBreakpoints` | `boolean` | `true` (when `autoAttachChildProcesses` is `true`) | Automatically detach from processes that don't have any verified breakpoints in their loaded sources. This reduces debugger overhead by only keeping the debugger attached to processes where you have active breakpoints. Set to `false` to keep debugger attached to all child processes regardless of breakpoints. |
| `breakpointVerificationDelayMs` | `number` | `3000` | Time in milliseconds to wait after attaching before verifying if any breakpoints are bound in the process. Increase this value if your processes take longer to load and bind breakpoints. |

### Standard Debug Configuration Options (Inherited by Child Processes)

These options from your main launch configuration are automatically applied to child process attach configurations:

| Option | Type | Description |
|--------|------|-------------|
| `program` | `string` | Path to the executable. Used for symbol loading in child processes. |
| `cwd` | `string` | Working directory. Used for source file mapping. |
| `MIMode` | `"gdb"` \| `"lldb"` | Debugger mode (Linux/macOS). Automatically selected based on platform. |
| `miDebuggerPath` | `string` | Path to the debugger executable. |
| `setupCommands` | `array` | Debugger setup commands passed to child processes. |
| `sourceFileMap` | `object` | Source file path mappings for debugging. |
| `symbolSearchPath` | `string` | Paths to search for symbol files. |
| `additionalSOLibSearchPath` | `string` | Additional paths to search for shared libraries. |

### Example with All Options

```json
{
  "type": "cppdbg",
  "request": "launch",
  "name": "Launch App with Smart Auto-Attach",
  "program": "${workspaceFolder}/out/App.app/Contents/MacOS/App",
  "cwd": "${workspaceFolder}",
  "MIMode": "lldb",
  "autoAttachChildProcesses": true,
  "autoDetachIfNoBreakpoints": true,
  "breakpointVerificationDelayMs": 3000,
  "sourceFileMap": {
    "../..": "${workspaceFolder}"
  }
}
```

### Breakpoint Verification Behavior

When `autoDetachIfNoBreakpoints` is enabled (default when using auto-attach):

1. The extension attaches the debugger to each new child process
2. After `breakpointVerificationDelayMs` (default 3 seconds), it checks if any of your breakpoints are verified/bound in that process
3. If the process has loaded sources containing your breakpoints, the debugger stays attached
4. If no breakpoints are verified in the process, the debugger automatically detaches
5. Detached processes are not re-attached (prevents attachment loops)

This is useful for multi-process applications (like Chromium-based apps) where you only want to debug specific processes that run the code you're working on.

## Benefits

- ✅ Cross-platform support (Windows, macOS, Linux)
- ✅ No workspace file modification needed
- ✅ No window reload needed
- ✅ Automatic detection and attachment
- ✅ Smart breakpoint filtering - only debugs processes with relevant code
- ✅ Reduced overhead - detaches from utility processes automatically
- ✅ Platform-aware debugger configuration
- ✅ Debug session stays active
- ✅ Works with any executable
- ✅ Prevents duplicate attachments

## Troubleshooting

**Extension not activating?**
- Check the Output panel (View → Output → "App Debug Helper" or "Extension Host")
- Make sure you installed the extension and reloaded VSCode

**Processes not being detected?**
- Make sure `autoAttachChildProcesses: true` is set in your launch configuration
- The extension checks every 2 seconds for new processes
- Make sure the processes are actually running (check Task Manager)
- Try manually triggering: `Ctrl+Shift+P` → "App Debug: Attach to All Processes"

**Want to disable auto-attach temporarily?**
- Remove or set `autoAttachChildProcesses: false` in your launch configuration

**Debugger detaching from processes you want to debug?**
- Increase `breakpointVerificationDelayMs` (e.g., to `5000`) if your processes take longer to load
- Set a breakpoint before starting the debug session
- Set `autoDetachIfNoBreakpoints: false` to keep debugger attached to all processes

**Want to debug all child processes without filtering?**
- Set `autoDetachIfNoBreakpoints: false` in your launch configuration
