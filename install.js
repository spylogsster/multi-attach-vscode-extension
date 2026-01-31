#!/usr/bin/env node

/* Copyright (c) 2026 Poletaev Sergei. All rights reserved.
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const { execSync } = require('child_process');

console.log('======================================');
console.log('Installing App Debug Helper Extension');
console.log('======================================');
console.log();

function exec(command, options = {}) {
  try {
    return execSync(command, { stdio: 'inherit', ...options });
  } catch (error) {
    process.exit(1);
  }
}

function checkCommand(command) {
  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Check if vsce is installed globally
console.log('Checking for vsce...');
const vsceInstalled = checkCommand('npm list -g @vscode/vsce');

if (!vsceInstalled) {
  console.log('Installing vsce globally...');
  exec('npm install -g @vscode/vsce');
}

console.log();
console.log('Installing dependencies...');
exec('npm install');

console.log();
console.log('Compiling TypeScript...');
exec('npm run compile');

console.log();
console.log('Packaging extension...');
exec('vsce package --allow-missing-repository');

console.log();
console.log('======================================');
console.log('Installation Complete!');
console.log('======================================');
console.log();
console.log('A .vsix file has been created in this directory.');
console.log();
console.log('To install the extension:');
console.log('1. Open VSCode');
console.log('2. Press Ctrl+Shift+X to open Extensions');
console.log('3. Click the "..." menu at the top');
console.log('4. Select "Install from VSIX..."');
console.log('5. Select the .vsix file from this directory');
console.log();
console.log('After installation, the extension will automatically');
console.log('attach to all App processes when you debug!');
console.log();
