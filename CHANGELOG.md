# Changelog

## [1.6.3] - 2026-02-02

### Fixed
- Race condition when attaching to processes that exit before attach completes
- Missing `program` property error on macOS by falling back to main program path when child executable not found
- Attach attempts continuing after main debug session terminates

## [1.6.2] and earlier

See [commit history](https://github.com/spylogsster/multi-attach-vscode-extension/commits/master) for previous changes.
