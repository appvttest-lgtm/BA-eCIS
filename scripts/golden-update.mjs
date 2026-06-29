// Rewrites the golden baselines (tests/fixtures/**/*.expected.json) by running the
// golden test with UPDATE_GOLDEN=1. Used after adding or changing fixtures, or when
// an engine change intentionally alters outcomes. Always review the resulting diff
// before committing - that diff is the whole point of the harness.
//
// Run: npm run golden:update   (shell-agnostic: sets the env var here, not in the script string)

import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--test', 'tests/golden.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, UPDATE_GOLDEN: '1' }
});

process.exit(result.status ?? 1);
