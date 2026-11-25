// Reads a growing file line by line: each call returns the complete lines added since the last one.
'use strict';
const fs = require('fs');

class FileTail {
  constructor(file) {
    this.file = file;
    this.reset();
  }

  reset() {
    this.offset = 0;
    this.unfinishedLine = Buffer.alloc(0);
    this.unfinishedLineOffset = 0;
  }

  setOffset(offset) {
    this.offset = Math.max(0, Number(offset) || 0);
    this.unfinishedLine = Buffer.alloc(0);
    this.unfinishedLineOffset = this.offset;
  }

  readNewLines() {
    return this.readNewRecords().map(record => record.line);
  }

  readNewRecords() {
    // size and read come from one open file, and only the bytes actually read are kept: the file can be cleared
    // between the two
    let fd;
    try { fd = fs.openSync(this.file, 'r'); } catch { return []; }
    let chunk;
    try {
      const size = fs.fstatSync(fd).size;
      if (size < this.offset) this.reset(); // the file was truncated or cleared
      chunk = Buffer.alloc(Math.max(0, size - this.offset));
      if (chunk.length) chunk = chunk.subarray(0, fs.readSync(fd, chunk, 0, chunk.length, this.offset));
    } finally {
      fs.closeSync(fd);
    }
    if (!chunk.length) return [];
    const chunkOffset = this.offset;
    this.offset += chunk.length;

    const data = Buffer.concat([this.unfinishedLine, chunk]);
    const records = [];
    let start = 0;
    let lineOffset = this.unfinishedLine.length ? this.unfinishedLineOffset : chunkOffset;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 10) continue;
      records.push({ line: data.subarray(start, i).toString('utf8'), offset: lineOffset });
      start = i + 1;
      lineOffset = chunkOffset + (i + 1 - this.unfinishedLine.length);
    }
    this.unfinishedLine = data.subarray(start);
    this.unfinishedLineOffset = lineOffset;
    return records;
  }
}

module.exports = { FileTail };
