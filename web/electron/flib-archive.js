const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { createInflateRaw } = require('zlib');

const ZIP32_MAX = 0xffffffff;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function updateCrc(crc, bytes) {
  let value = crc;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

async function writeFully(file, bytes, position) {
  let written = 0;
  while (written < bytes.length) {
    const result = await file.write(bytes, written, bytes.length - written, position + written);
    if (!result.bytesWritten) throw new Error('Could not write the archive.');
    written += result.bytesWritten;
  }
  return position + written;
}

function makeLocalHeader(name, flags, crc = 0, size = 0, descriptor = false) {
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(flags, 6);
  header.writeUInt16LE(0, 8); // Stored entries avoid recompressing audio and artwork.
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x21, 12); // 1980-01-01 in DOS date format.
  header.writeUInt32LE(descriptor ? 0 : crc, 14);
  header.writeUInt32LE(descriptor ? 0 : size, 18);
  header.writeUInt32LE(descriptor ? 0 : size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function makeCentralHeader(entry) {
  const header = Buffer.alloc(46 + entry.name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(entry.flags, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x21, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(entry.directory ? 0x10 : 0, 38);
  header.writeUInt32LE(entry.offset, 42);
  entry.name.copy(header, 46);
  return header;
}

async function writeZipArchive(destination, items) {
  if (items.length > 0xffff - 3) throw new Error('This library contains too many files for a .flib archive.');
  const file = await fs.promises.open(destination, 'w');
  const centralEntries = [];
  let offset = 0;
  try {
    const directories = ['artwork/', 'audio/', 'lyrics/'];
    for (const directory of directories) {
      const name = Buffer.from(directory, 'utf8');
      const flags = 0x0800;
      const local = makeLocalHeader(name, flags);
      await writeFully(file, local, offset);
      centralEntries.push({ name, flags, crc: 0, size: 0, offset, directory: true });
      offset += local.length;
    }

    for (const item of items) {
      const archivePath = String(item.archivePath).replace(/\\/g, '/');
      if (!archivePath || archivePath.startsWith('/') || archivePath.split('/').includes('..')) {
        throw new Error('The archive contains an invalid file path.');
      }
      const name = Buffer.from(archivePath, 'utf8');
      if (name.length > 0xffff) throw new Error(`Archive path is too long: ${archivePath}`);
      const flags = 0x0808; // UTF-8 name and trailing data descriptor.
      const local = makeLocalHeader(name, flags, 0, 0, true);
      const localOffset = offset;
      offset = await writeFully(file, local, offset);

      let size = 0;
      let crc = 0xffffffff;
      for await (const chunk of fs.createReadStream(item.diskPath)) {
        size += chunk.length;
        if (size > ZIP32_MAX || offset + size > ZIP32_MAX) throw new Error('This archive is too large for the .flib format.');
        crc = updateCrc(crc, chunk);
        offset = await writeFully(file, chunk, offset);
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      offset = await writeFully(file, descriptor, offset);
      centralEntries.push({ name, flags, crc, size, offset: localOffset, directory: false });
    }

    const centralOffset = offset;
    for (const entry of centralEntries) offset = await writeFully(file, makeCentralHeader(entry), offset);
    const centralSize = offset - centralOffset;
    if (offset > ZIP32_MAX || centralSize > ZIP32_MAX || centralOffset > ZIP32_MAX) {
      throw new Error('This archive is too large for the .flib format.');
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(centralEntries.length, 8);
    end.writeUInt16LE(centralEntries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);
    await writeFully(file, end, offset);
  } finally {
    await file.close();
  }
}

async function readAt(file, length, position) {
  const bytes = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await file.read(bytes, read, length - read, position + read);
    if (!result.bytesRead) throw new Error('The .flib archive is incomplete or damaged.');
    read += result.bytesRead;
  }
  return bytes;
}

function validateArchivePath(name) {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name)) return false;
  const parts = name.split('/').filter(part => part && part !== '.');
  return parts.length > 0 && parts.every(part => part !== '..');
}

async function readZipDirectory(archivePath) {
  const file = await fs.promises.open(archivePath, 'r');
  try {
    const stat = await file.stat();
    const tailSize = Math.min(stat.size, 0xffff + 22);
    const tail = await readAt(file, tailSize, stat.size - tailSize);
    let endOffset = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) {
        endOffset = index;
        break;
      }
    }
    if (endOffset < 0) throw new Error('That file is not a valid .flib ZIP archive.');
    const end = tail.subarray(endOffset);
    const entriesOnDisk = end.readUInt16LE(8);
    const entryCount = end.readUInt16LE(10);
    const directorySize = end.readUInt32LE(12);
    const directoryOffset = end.readUInt32LE(16);
    if (entriesOnDisk !== entryCount || entryCount === 0xffff || directorySize === ZIP32_MAX || directoryOffset === ZIP32_MAX || directoryOffset + directorySize > stat.size) {
      throw new Error('That .flib archive uses an unsupported ZIP layout.');
    }
    if (entryCount > 0xffff - 3) throw new Error('The archive contains too many files.');

    const entries = [];
    let position = directoryOffset;
    for (let index = 0; index < entryCount; index += 1) {
      const fixed = await readAt(file, 46, position);
      if (fixed.readUInt32LE(0) !== 0x02014b50) throw new Error('The .flib archive directory is damaged.');
      const flags = fixed.readUInt16LE(8);
      const method = fixed.readUInt16LE(10);
      const crc = fixed.readUInt32LE(16);
      const compressedSize = fixed.readUInt32LE(20);
      const uncompressedSize = fixed.readUInt32LE(24);
      const nameLength = fixed.readUInt16LE(28);
      const extraLength = fixed.readUInt16LE(30);
      const commentLength = fixed.readUInt16LE(32);
      const localOffset = fixed.readUInt32LE(42);
      if (compressedSize === ZIP32_MAX || uncompressedSize === ZIP32_MAX || localOffset === ZIP32_MAX || (flags & 1)) {
        throw new Error('The archive contains an unsupported or encrypted entry.');
      }
      const nameBuffer = await readAt(file, nameLength, position + 46);
      const name = nameBuffer.toString(flags & 0x0800 ? 'utf8' : 'utf8');
      if (!validateArchivePath(name)) throw new Error('The archive contains an unsafe file path.');
      entries.push({ name, flags, method, crc, compressedSize, uncompressedSize, localOffset, directory: name.endsWith('/') });
      position += 46 + nameLength + extraLength + commentLength;
    }
    if (position > directoryOffset + directorySize) throw new Error('The .flib archive directory is damaged.');
    return entries;
  } finally {
    await file.close();
  }
}

async function extractZipEntry(archivePath, entry, destination) {
  if (entry.directory) {
    await fs.promises.mkdir(destination, { recursive: true });
    return;
  }
  if (![0, 8].includes(entry.method)) throw new Error(`Unsupported ZIP compression for ${entry.name}.`);
  const file = await fs.promises.open(archivePath, 'r');
  let dataStart;
  try {
    const header = await readAt(file, 30, entry.localOffset);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`The archive entry ${entry.name} is damaged.`);
    dataStart = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (dataStart + entry.compressedSize > (await file.stat()).size) throw new Error(`The archive entry ${entry.name} is truncated.`);
  } finally {
    await file.close();
  }

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  let crc = 0xffffffff;
  let size = 0;
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > entry.uncompressedSize) return callback(new Error(`The archive entry ${entry.name} expands beyond its declared size.`));
      crc = updateCrc(crc, chunk);
      callback(null, chunk);
    }
  });
  const start = dataStart;
  const end = dataStart + entry.compressedSize - 1;
  const source = entry.compressedSize ? fs.createReadStream(archivePath, { start, end }) : Readable.from([]);
  const stages = [source];
  if (entry.method === 8) stages.push(createInflateRaw());
  stages.push(verifier, fs.createWriteStream(destination, { flags: 'wx' }));
  await pipeline(...stages);
  crc = (crc ^ 0xffffffff) >>> 0;
  if (size !== entry.uncompressedSize || crc !== entry.crc) {
    await fs.promises.rm(destination, { force: true });
    throw new Error(`The archive entry ${entry.name} failed its integrity check.`);
  }
}

module.exports = { writeZipArchive, readZipDirectory, extractZipEntry };
