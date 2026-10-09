import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/';
const directory = fileURLToPath(new URL('../public/models/coco-ssd/', import.meta.url));
const temporary = path.join(directory, '.download');
let pinnedFiles = new Map();
try {
  const installed = JSON.parse(await readFile(path.join(directory, 'provenance.json'), 'utf8'));
  if (installed.source !== source) throw new Error('Existing model provenance has an unexpected source');
  pinnedFiles = new Map(installed.files.map((file) => [file.path, file.sha256]));
} catch (error) { if (error.code !== 'ENOENT') throw error; }

// curl preserves the cloud environment's existing HTTPS proxy and certificate
// trust. There is deliberately no insecure TLS fallback or checksum override.
async function download(name) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Unexpected model asset path');
  const destination = path.join(temporary, name);
  const headersPath = `${destination}.headers`;
  execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https',
    '--connect-timeout', '20', '--max-time', '120', '--dump-header', headersPath, '--output', destination, source + name], { stdio: 'inherit' });
  const data = await readFile(destination);
  const headers = await readFile(headersPath, 'utf8');
  // Google publishes the object checksum in its authenticated response headers.
  const publishedMD5 = [...headers.matchAll(/^x-goog-hash:.*?md5=([^,\s\r\n]+)/gim)].at(-1)?.[1];
  if (!publishedMD5) throw new Error(`Upstream checksum missing for ${name}`);
  const md5 = createHash('md5').update(data).digest('base64');
  if (md5 !== publishedMD5) throw new Error(`Upstream checksum mismatch for ${name}`);
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (pinnedFiles.size && pinnedFiles.get(name) !== sha256) throw new Error(`Pinned SHA-256 mismatch for ${name}; review the upstream change before replacing assets`);
  return { path: name, sha256, upstreamMD5: publishedMD5, bytes: data.length };
}

await mkdir(temporary, { recursive: true });
try {
  const files = [await download('model.json')];
  const model = JSON.parse(await readFile(path.join(temporary, 'model.json'), 'utf8'));
  const names = [...new Set(model.weightsManifest.flatMap((group) => group.paths))];
  if (!names.length || names.length > 20) throw new Error('Unexpected model weight manifest');
  for (const name of names) files.push(await download(name));
  const provenance = { name: 'TensorFlow.js COCO SSD lite_mobilenet_v2', source,
    upstreamPackage: '@tensorflow-models/coco-ssd@2.2.3', license: 'Apache-2.0',
    verification: 'Verified HTTPS, Google published MD5, and recorded SHA-256', files };
  await writeFile(path.join(temporary, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  for (const name of [...files.map((file) => file.path), 'provenance.json']) await rename(path.join(temporary, name), path.join(directory, name));
  console.log(`Installed ${files.length} verified model assets in public/models/coco-ssd.`);
} catch (error) {
  console.error('The object model could not be installed. Face and browser checks can still run.');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
