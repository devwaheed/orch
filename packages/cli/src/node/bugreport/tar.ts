/**
 * Minimal uncompressed POSIX ustar writer (node:fs/node:zlib only; no new
 * dependency). Enough to build the bug-report bundle: a streaming-free, fully
 * in-memory tar with file and directory entries and two zero end blocks.
 * Entry names use forward slashes, no leading `/`, and stay under 100 bytes.
 */

export interface TarEntry {
  /** Archive path, e.g. `logs/2026-10-11.log`. */
  readonly name: string;
  readonly content: Buffer;
  readonly type?: 'file' | 'directory';
  readonly mode?: number;
  readonly mtime?: number;
}

const TAR_BLOCK = 512;

function writeOctal(
  header: Buffer,
  offset: number,
  value: number,
  width: number,
): void {
  const digits = value.toString(8).padStart(width - 1, '0');
  header.write(digits, offset, width - 1, 'ascii');
  header[offset + width - 1] = 0;
}

function buildHeader(entry: TarEntry): Buffer {
  const header = Buffer.alloc(TAR_BLOCK, 0);
  const name = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
  header.write(name, 0, Math.min(name.length, 100), 'ascii');

  writeOctal(header, 100, entry.mode ?? 0o644, 8);
  writeOctal(header, 108, 0, 8); // uid
  writeOctal(header, 116, 0, 8); // gid
  writeOctal(header, 124, entry.content.length, 12);
  writeOctal(header, 136, Math.floor(entry.mtime ?? Date.now() / 1000), 12);

  // Checksum: computed over the header with the field filled with spaces.
  header.fill(0x20, 148, 156);
  header.write(entry.type === 'directory' ? '5' : '0', 156, 1, 'ascii');
  header.write('ustar', 257, 5, 'ascii');
  header.write('00', 263, 2, 'ascii'); // version

  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  const checksum = `${sum.toString(8).padStart(6, '0')}\0 `;
  header.write(checksum, 148, 8, 'ascii');
  return header;
}

function padToBlock(content: Buffer): Buffer {
  const remainder = content.length % TAR_BLOCK;
  if (remainder === 0) {
    return content;
  }
  const padded = Buffer.alloc(content.length + (TAR_BLOCK - remainder), 0);
  content.copy(padded);
  return padded;
}

/** Serializes entries into one uncompressed tar byte buffer. */
export function createTar(entries: readonly TarEntry[]): Buffer {
  const parts: Buffer[] = [];

  for (const entry of entries) {
    let content = entry.content;
    if (entry.type !== 'directory') {
      content = padToBlock(content);
    }
    parts.push(buildHeader(entry));
    parts.push(content);
  }

  // Two zero blocks close the archive.
  const end = Buffer.alloc(TAR_BLOCK * 2, 0);
  return Buffer.concat([...parts, end]);
}

export interface TarMember {
  readonly name: string;
  readonly type: 'file' | 'directory';
  readonly content: Buffer;
}

const NAME_LENGTH = 100;
const SIZE_OFFSET = 124;
const SIZE_LENGTH = 12;
const TYPE_OFFSET = 156;

/** Parses a tar produced by createTar, for tests and for reading a bundle back. */
export function parseTar(buffer: Buffer): TarMember[] {
  const members: TarMember[] = [];
  let offset = 0;
  while (offset + TAR_BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + TAR_BLOCK);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = header.subarray(0, NAME_LENGTH).toString('ascii').replace(/\0.*$/, '');
    if (name.length === 0) {
      offset += TAR_BLOCK;
      continue;
    }
    const type = header[TYPE_OFFSET] === 0x35 ? ('directory' as const) : ('file' as const);
    const sizeText = header.subarray(SIZE_OFFSET, SIZE_OFFSET + SIZE_LENGTH).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText, 8) || 0;
    offset += TAR_BLOCK;
    const content = buffer.subarray(offset, offset + size);
    offset += Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
    members.push({ name, type, content: Buffer.from(content) });
  }
  return members;
}