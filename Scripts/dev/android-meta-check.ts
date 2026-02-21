#!/usr/bin/env bun

import { runAndroidMetaCheck } from './android-meta-check-lib';

function printSection(title: string, items: string[]): void {
  if (items.length === 0) {
    return;
  }

  console.log(`\n[${title}]`);
  for (const item of items) {
    console.log(`- ${item}`);
  }
}

function main(): void {
  const report = runAndroidMetaCheck(process.cwd());

  printSection('Info', report.infos);
  printSection('Warnings', report.warnings);
  printSection('Errors', report.errors);

  if (report.errors.length > 0) {
    console.error(`\n[android-meta-check] failed with ${report.errors.length} error(s).`);
    process.exit(1);
  }

  console.log('\n[android-meta-check] passed.');
}

main();
