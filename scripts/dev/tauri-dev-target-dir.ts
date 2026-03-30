#!/usr/bin/env bun

import { resolveTauriDevTargetDir } from './tauri-dev-target-dir-lib';

const projectRoot = process.argv[2]?.trim() || process.cwd();
process.stdout.write(resolveTauriDevTargetDir(projectRoot, process.env));
