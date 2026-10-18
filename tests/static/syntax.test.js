import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = readdirSync('docs').filter(f => f.endsWith('.js')).map(f => `docs/${f}`);

describe('JavaScript syntax', () => {
  it.each(files)('%s parses', file => {
    expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
  });
});
