#!/usr/bin/env node
// Package script for production extension distribution
// Excludes test files, dev dependencies, and other non-production files

import { execSync } from 'child_process';
import { existsSync, unlinkSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

const ZIP_NAME = join(ROOT_DIR, 'poor-mans-suite-extension.zip');

console.log("📦 Creating Poor Man's Suite production package...\n");

// Remove old zip if it exists
if (existsSync(ZIP_NAME)) {
  console.log(`Removing existing ${ZIP_NAME}...`);
  unlinkSync(ZIP_NAME);
}

try {
  // Use find to get all files, explicitly excluding directories
  // This is more reliable than zip's exclude patterns
  console.log('Collecting files to package...');
  
  const findCommand = `find . -type f ! -path './.git/*' ! -path './node_modules/*' ! -path './tests/*' ! -path './scripts/*' ! -path './dist/*' ! -path './build/*' ! -path './coverage/*' ! -path './.nyc_output/*' ! -path './temp/*' ! -name '*.test.js' ! -name '*.spec.js' ! -name '*.zip' ! -name 'package.json' ! -name 'package-lock.json' ! -name 'vitest.config.js' ! -name '.gitignore' ! -name 'ARCHITECTURE_REVIEW.md' ! -name 'CONTRIBUTING.md' ! -name 'Agent.md' ! -name '.DS_Store'`;
  
  const files = execSync(findCommand, { 
    encoding: 'utf-8',
    cwd: ROOT_DIR
  }).trim().split('\n').filter(f => {
    const file = f.trim();
    return file.length > 0 && 
           !file.includes('node_modules/') && 
           !file.includes('tests/') && 
           !file.includes('scripts/') &&
           !file.endsWith('.test.js') &&
           !file.endsWith('.spec.js');
  });

  if (files.length === 0) {
    throw new Error('No files found to package');
  }

  console.log(`Found ${files.length} files to package...`);

  // Write file list to temp file (zip can read from file list with -i@)
  const fileListPath = join(ROOT_DIR, '.zip-files.txt');
  writeFileSync(fileListPath, files.map(f => f.replace(/^\.\//, '')).join('\n'));

  // Create zip using file list with -i@ option
  const zipCommand = `zip -r ${ZIP_NAME} . -q -i@${fileListPath}`;

  console.log('Packaging files...');
  execSync(zipCommand, { 
    stdio: 'inherit',
    cwd: ROOT_DIR
  });

  // Clean up temp file
  if (existsSync(fileListPath)) {
    unlinkSync(fileListPath);
  }

  // Get file size
  const stats = statSync(ZIP_NAME);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`\n✅ Package created: ${ZIP_NAME} (${sizeMB} MB)`);
  console.log('\n📋 Excluded from package:');
  console.log('   - Test files (tests/, *.test.js, *.spec.js)');
  console.log('   - Dev dependencies (node_modules/, package.json)');
  console.log('   - Build config (vitest.config.js)');
  console.log('   - Git files (.git/, .gitignore)');
  console.log('   - Internal/development documentation (Agent.md, CONTRIBUTING.md, ARCHITECTURE_REVIEW.md)');
  console.log('   - Build artifacts and existing zip archives');
  console.log('   - Scripts folder (scripts/)');
  console.log('\n🚀 Ready for distribution!');
  
} catch (error) {
  console.error('\n❌ Error creating package:', error.message);
  console.error('\n💡 Tip: Make sure you have the `zip` command installed.');
  console.error('   macOS: Built-in');
  console.error('   Linux: sudo apt-get install zip');
  console.error('   Windows: Use PowerShell script: .\\scripts\\package.ps1');
  process.exit(1);
}
