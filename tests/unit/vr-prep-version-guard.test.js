import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// The finished VR data kept on the device (vr-prep-cache.js) is invalidated ONLY by VR_PREP_VERSION (docs/vr-view.js); the build number is not part of the keys.
// So when the code that GENERATES that data changes, VR_PREP_VERSION must be bumped, or devices keep reading data made by the old code.
// This test hashes the generating sources (the worker steps and what they call, and the entry format). When the hash changes:
//   - the output of the preparation changed (or the entry format)  -> bump VR_PREP_VERSION in docs/vr-view.js, then add a line "<new version>: '<new hash>'" below;
//   - only comments / names changed, the output is the same        -> you may add the new hash under the SAME version (replace its line) - say why in the commit.
// Not covered: the page-side steps of prepareVrData inside docs/vr-view.js (reading the slices, the processing mask, the analysis index); bump by hand when those change what is stored.
const SOURCES = ['vr-volume-prep.js', 'point-cls.js', 'distance-field.js', 'vr-brick-occupancy.js', 'gpu-runs.js', 'vr-prep-cache.js'];
const KNOWN_HASHES = {
  3: '537024a77ad091c7',
  5: 'd272302c85831b6e', // the list entries carry segMask (the prepared slot bits). (child segments): the new buildChildIndexOf + a `child` field of the worker answer, present only when child items were sent; the output WITHOUT child segments is byte-identical to before, and an entry made with children has its own key (the child items are an extra hashed `child` part), so no old entry can be mistaken for it: same version
  4: '18ca6924fc9d55f1', // buildRegionIndexOf keeps every result (up to 255) in ids / list, the 14-colour cap only limits the colour index of the histogram (a result of the 15th colour used to be dropped)
};

const read = f => readFileSync(new URL('../../docs/' + f, import.meta.url), 'utf8');
// the cache-busting "?v=<date>-build<N>" of the import lines changes with every build number: it is not part of the code's behaviour
const normalize = text => text.replace(/\r\n/g, '\n').replace(/\?v=[0-9]+-build[0-9]+/g, '');
const sourcesHash = () => { const h = createHash('sha256'); for (const f of SOURCES) h.update(f + '\n' + normalize(read(f)) + '\n'); return h.digest('hex').slice(0, 16); };
const currentVersion = () => { const m = /const VR_PREP_VERSION=(\d+);/.exec(read('vr-view.js')); if (!m) throw new Error('VR_PREP_VERSION not found in docs/vr-view.js'); return +m[1]; };

describe('VR_PREP_VERSION guard', () => {
  it('the generating sources match the hash recorded for the current VR_PREP_VERSION', () => {
    const v = currentVersion(), now = sourcesHash();
    expect(KNOWN_HASHES, `VR_PREP_VERSION is ${v}: add "${v}: '${now}'" to KNOWN_HASHES in tests/unit/vr-prep-version-guard.test.js`).toHaveProperty(String(v));
    expect(now, `The code that makes the VR data (${SOURCES.join(', ')}) changed but VR_PREP_VERSION is still ${v}. Bump VR_PREP_VERSION in docs/vr-view.js (otherwise devices keep reading data made by the old code), then record "${v + 1}: '${now}'" in KNOWN_HASHES. (Only comments changed? Replace the hash of version ${v} with '${now}'.)`).toBe(KNOWN_HASHES[v]);
  });

  it('the build number is not part of a cache key', () => {
    const src = read('vr-view.js');
    for (const line of src.split('\n')) if (/prep:VR_PREP_VERSION/.test(line) && /partsOf\(/.test(line)) expect(line, 'build must not be a key part').not.toContain('APP_BUILD');
  });
});
