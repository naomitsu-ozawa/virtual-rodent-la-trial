import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const read = path => JSON.parse(strFromU8(unzipSync(new Uint8Array(readFileSync(new URL(path, import.meta.url))))['project.json']));

describe('bundled practice projects', () => {
  it('sample2/project.vrlab is a project saved from the sample2 (mouse) series', () => {
    const p = read('../../docs/demo/sample2/project.vrlab');
    const s1 = read('../../docs/demo/sample1/project.vrlab');
    expect(p.format).toBe('virtual-rodent-lab-project');
    expect(p.dataset.seriesUid).toBe('1.2.3.11.22.33.20250707145827');
    expect(p.dataset.slices).toBe(512);
    expect(p.dataset.seriesUid).not.toBe(s1.dataset.seriesUid);
  });
});
