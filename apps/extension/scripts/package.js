/**
 * Zero-dependency cross-platform ZIP packaging script for DevMirror Chrome Extension.
 * Produces clean production-ready extension ZIP packages for Chrome Web Store and developer testing.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(EXTENSION_ROOT, 'dist');

function createZipBuffer(entries) {
  const zipEntries = [];
  const localHeaders = [];

  for (const entry of entries) {
    const rawData = entry.content;
    const crc = zlib.crc32(rawData);
    const compressed = zlib.deflateRawSync(rawData);
    const filenameBuf = Buffer.from(entry.path.replace(/\\/g, '/'), 'utf-8');

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + filenameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);          // version needed
    localHeader.writeUInt16LE(0, 6);           // flags
    localHeader.writeUInt16LE(8, 8);           // compression (deflate)
    localHeader.writeUInt16LE(0, 10);          // time
    localHeader.writeUInt16LE(0, 12);          // date
    localHeader.writeUInt32LE(crc, 14);        // crc-32
    localHeader.writeUInt32LE(compressed.length, 18); // compressed size
    localHeader.writeUInt32LE(rawData.length, 22);    // uncompressed size
    localHeader.writeUInt16LE(filenameBuf.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28);                  // extra field length
    filenameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressed);
    zipEntries.push({
      filename: entry.path.replace(/\\/g, '/'),
      data: rawData,
      crc32: crc,
      compressed
    });
  }

  // Calculate central directory
  const cdHeaders = [];
  let centralDirSize = 0;
  let runningOffset = 0;

  for (let i = 0; i < zipEntries.length; i++) {
    const e = zipEntries[i];
    const filenameBuf = Buffer.from(e.filename, 'utf-8');
    const cdHeader = Buffer.alloc(46 + filenameBuf.length);

    cdHeader.writeUInt32LE(0x02014b50, 0); // signature
    cdHeader.writeUInt16LE(20, 4);          // version made by
    cdHeader.writeUInt16LE(20, 6);          // version needed
    cdHeader.writeUInt16LE(0, 8);           // flags
    cdHeader.writeUInt16LE(8, 10);          // compression
    cdHeader.writeUInt16LE(0, 12);          // time
    cdHeader.writeUInt16LE(0, 14);          // date
    cdHeader.writeUInt32LE(e.crc32, 16);    // crc-32
    cdHeader.writeUInt32LE(e.compressed.length, 20); // compressed size
    cdHeader.writeUInt32LE(e.data.length, 24);       // uncompressed size
    cdHeader.writeUInt16LE(filenameBuf.length, 28);  // file name length
    cdHeader.writeUInt16LE(0, 30);          // extra field length
    cdHeader.writeUInt16LE(0, 32);          // file comment length
    cdHeader.writeUInt16LE(0, 34);          // disk number start
    cdHeader.writeUInt16LE(0, 36);          // internal file attributes
    cdHeader.writeUInt32LE(0, 38);          // external file attributes
    cdHeader.writeUInt32LE(runningOffset, 42); // relative offset of local header
    filenameBuf.copy(cdHeader, 46);

    cdHeaders.push(cdHeader);
    centralDirSize += cdHeader.length;

    // advance runningOffset by localHeader + compressed
    runningOffset += (30 + filenameBuf.length + e.compressed.length);
  }

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4);          // disk number
  eocd.writeUInt16LE(0, 6);          // cd start disk
  eocd.writeUInt16LE(zipEntries.length, 8);  // total entries this disk
  eocd.writeUInt16LE(zipEntries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12);    // cd size
  eocd.writeUInt32LE(runningOffset, 16);     // offset of start of cd
  eocd.writeUInt16LE(0, 20);                 // comment length

  return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
}

function collectDistFiles() {
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error('Extension dist/ directory does not exist. Run "pnpm run build" first.');
  }

  const results = [];

  function scan(dir, prefix = '') {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      if (item.endsWith('.zip')) continue;
      const fullPath = path.join(dir, item);
      const relPath = prefix ? `${prefix}/${item}` : item;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scan(fullPath, relPath);
      } else {
        results.push({ path: relPath, content: fs.readFileSync(fullPath) });
      }
    }
  }

  scan(DIST_DIR);
  return results;
}

export function packageExtension() {
  console.log('Packaging Chrome Extension...');
  const baseFiles = collectDistFiles();

  // 1. Build dev unpacked ZIP (preserves deterministic key for sideloading)
  const devZip = createZipBuffer(baseFiles);
  const devZipPath = path.join(DIST_DIR, 'devmirror-extension-unpacked-v0.1.0.zip');
  fs.writeFileSync(devZipPath, devZip);
  console.log(`✔ Created: ${devZipPath} (${(devZip.length / 1024).toFixed(1)} KB)`);

  // 2. Build Chrome Web Store submission ZIP (removes 'key' field as required by Web Store policy)
  const webStoreFiles = baseFiles.map(file => {
    if (file.path === 'manifest.json') {
      const manifest = JSON.parse(file.content.toString('utf-8'));
      delete manifest.key; // Forbidden by Chrome Web Store Developer Dashboard
      return { path: 'manifest.json', content: Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8') };
    }
    return file;
  });

  const webstoreZip = createZipBuffer(webStoreFiles);
  const webstoreZipPath = path.join(DIST_DIR, 'devmirror-extension-webstore-v0.1.0.zip');
  fs.writeFileSync(webstoreZipPath, webstoreZip);
  console.log(`✔ Created: ${webstoreZipPath} (${(webstoreZip.length / 1024).toFixed(1)} KB)`);
}

// Auto-run when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  packageExtension();
}
