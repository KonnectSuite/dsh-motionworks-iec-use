// Minimal synthetic CFB/property-set wrapper; contains no customer project data.
export function mwtFixture(directory) {
  const end = 0xfffffffe, free = 0xffffffff;
  const header = Buffer.alloc(512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header);
  [0x3e, 3, 0xfffe, 9, 6].forEach((v, n) => header.writeUInt16LE(v, 24 + n * 2));
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(0, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(end, 60);
  header.writeUInt32LE(end, 68);
  for (let off = 76; off < 512; off += 4) header.writeUInt32LE(free, off);
  header.writeUInt32LE(1, 76);
  const entries = Buffer.alloc(512);
  function entry(offset, name, type, start, size, child = free) {
    const encoded = Buffer.from(name + '\0', 'utf16le');
    encoded.copy(entries, offset);
    entries.writeUInt16LE(encoded.length, offset + 64);
    entries[offset + 66] = type;
    entries[offset + 67] = 1;
    entries.writeUInt32LE(free, offset + 68);
    entries.writeUInt32LE(free, offset + 72);
    entries.writeUInt32LE(child, offset + 76);
    entries.writeUInt32LE(start, offset + 116);
    entries.writeBigUInt64LE(BigInt(size), offset + 120);
  }
  entry(0, 'Root Entry', 5, end, 0, 1);
  entry(128, 'Properties', 2, 2, 4096);
  const fat = Buffer.alloc(512, 0xff);
  fat.writeUInt32LE(end, 0);
  fat.writeUInt32LE(0xfffffffd, 4);
  for (let sector = 2; sector < 10; sector++) fat.writeUInt32LE(sector === 9 ? end : sector + 1, sector * 4);
  const stream = Buffer.alloc(4096);
  const path = Buffer.from(directory + '\0', 'utf16le');
  stream.writeUInt16LE(0xfffe, 0);
  stream.writeUInt32LE(1, 24);
  stream.writeUInt32LE(48, 44);
  stream.writeUInt32LE(24 + Math.ceil(path.length / 4) * 4, 48);
  stream.writeUInt32LE(1, 52);
  stream.writeUInt32LE(2, 56);
  stream.writeUInt32LE(16, 60);
  stream.writeUInt32LE(8, 64);
  stream.writeUInt32LE(path.length, 68);
  path.copy(stream, 72);
  return Buffer.concat([header, entries, fat, stream]);
}
