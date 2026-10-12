import * as zlib from 'node:zlib';

export interface ZipEntry {
  readonly name: string;
  readonly content: Buffer;
  readonly mtime?: Date;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { time: dosTime, date: dosDate };
}

/**
 * Creates a standard zip archive using node:zlib (deflateRawSync and crc32).
 * No external dependencies.
 */
export function createZip(entries: readonly ZipEntry[]): Buffer {
  const fileRecords: {
    name: string;
    nameBuf: Buffer;
    crc: number;
    compressedSize: number;
    uncompressedSize: number;
    header: Buffer;
    deflated: Buffer;
    offset: number;
    dosTime: number;
    dosDate: number;
  }[] = [];

  let offset = 0;

  for (const entry of entries) {
    const data = entry.content;
    const uncompressedSize = data.length;
    const crc = (zlib.crc32(data) >>> 0);
    const deflated = zlib.deflateRawSync(data);
    const compressedSize = deflated.length;
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const { time, date } = dosDateTime(entry.mtime ?? new Date());

    // Local file header: 30 bytes + name length
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // signature
    header.writeUInt16LE(20, 4); // version needed (2.0)
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(8, 8); // compression method (8 = deflate)
    header.writeUInt16LE(time, 10); // file time
    header.writeUInt16LE(date, 12); // file date
    header.writeUInt32LE(crc, 14); // crc32
    header.writeUInt32LE(compressedSize, 18); // compressed size
    header.writeUInt32LE(uncompressedSize, 22); // uncompressed size
    header.writeUInt16LE(nameBuf.length, 26); // file name length
    header.writeUInt16LE(0, 28); // extra field length

    fileRecords.push({
      name: entry.name,
      nameBuf,
      crc,
      compressedSize,
      uncompressedSize,
      header,
      deflated,
      offset,
      dosTime: time,
      dosDate: date,
    });

    offset += header.length + nameBuf.length + deflated.length;
  }

  const centralRecords: Buffer[] = [];
  let centralDirSize = 0;

  for (const rec of fileRecords) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central dir signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(8, 10); // compression method (8 = deflate)
    cd.writeUInt16LE(rec.dosTime, 12);
    cd.writeUInt16LE(rec.dosDate, 14);
    cd.writeUInt32LE(rec.crc, 16);
    cd.writeUInt32LE(rec.compressedSize, 20);
    cd.writeUInt32LE(rec.uncompressedSize, 24);
    cd.writeUInt16LE(rec.nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra length
    cd.writeUInt16LE(0, 32); // comment length
    cd.writeUInt16LE(0, 34); // disk number start
    cd.writeUInt16LE(0, 36); // internal file attrs
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external file attrs
    cd.writeUInt32LE(rec.offset, 42); // relative offset of local header

    const cdRecord = Buffer.concat([cd, rec.nameBuf]);
    centralRecords.push(cdRecord);
    centralDirSize += cdRecord.length;
  }

  const centralDirOffset = offset;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // eocd signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk where cd starts
  eocd.writeUInt16LE(fileRecords.length, 8); // number of cd records on this disk
  eocd.writeUInt16LE(fileRecords.length, 10); // total number of cd records
  eocd.writeUInt32LE(centralDirSize, 12); // size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16); // offset of start of central directory
  eocd.writeUInt16LE(0, 20); // comment length

  const chunks: Buffer[] = [];
  for (const rec of fileRecords) {
    chunks.push(rec.header, rec.nameBuf, rec.deflated);
  }
  for (const cd of centralRecords) {
    chunks.push(cd);
  }
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

export interface ParsedZipEntry {
  readonly name: string;
  readonly content: Buffer;
}

/**
 * Parses a zip archive created by createZip or standard zip tools.
 * Verifies CRC32 and inflates with node:zlib.inflateRawSync.
 */
export function parseZip(buf: Buffer): ParsedZipEntry[] {
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('No End of Central Directory (EOCD) record found in zip buffer');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let current = cdOffset;
  const entries: ParsedZipEntry[] = [];
  for (let i = 0; i < totalEntries; i++) {
    const sig = buf.readUInt32LE(current);
    if (sig !== 0x02014b50) {
      throw new Error(`Invalid Central Directory header signature at offset ${current}`);
    }
    const method = buf.readUInt16LE(current + 10);
    const crc = buf.readUInt32LE(current + 16);
    const compSize = buf.readUInt32LE(current + 20);
    const uncompSize = buf.readUInt32LE(current + 24);
    const nameLen = buf.readUInt16LE(current + 28);
    const extraLen = buf.readUInt16LE(current + 30);
    const commentLen = buf.readUInt16LE(current + 32);
    const localHeaderOffset = buf.readUInt32LE(current + 42);

    const name = buf.toString('utf8', current + 46, current + 46 + nameLen);

    const localSig = buf.readUInt32LE(localHeaderOffset);
    if (localSig !== 0x04034b50) {
      throw new Error(`Invalid Local File Header signature at offset ${localHeaderOffset}`);
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    const compressedData = buf.subarray(dataOffset, dataOffset + compSize);
    let data: Buffer;
    if (method === 0) {
      data = compressedData;
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported compression method in zip: ${method}`);
    }

    if (data.length !== uncompSize) {
      throw new Error(`Uncompressed size mismatch for ${name}: expected ${uncompSize}, got ${data.length}`);
    }
    const computedCrc = (zlib.crc32(data) >>> 0);
    if (computedCrc !== crc) {
      throw new Error(`CRC32 mismatch for ${name}: expected ${crc}, got ${computedCrc}`);
    }

    entries.push({ name, content: data });
    current += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}
