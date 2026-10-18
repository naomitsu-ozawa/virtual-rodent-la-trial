// Minimal static file server for docs/, mimicking GitHub Pages (no bundling,
// no transforms). Used by Playwright and handy for local manual testing:
//   node scripts/serve-docs.mjs [port] [directory=docs]
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { staticHandler } from './static-handler.mjs';

const port = Number(process.argv[2] || process.env.PORT || 4173);
const root = resolve(process.argv[3] || 'docs');

createServer(staticHandler(root)).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}`));
