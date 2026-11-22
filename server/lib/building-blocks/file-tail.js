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
    let size;
    try { size = fs.statSync(this.file).size; } catch { return []; }
    if (size < this.offset) this.reset(); // the file was truncated or cleared
    if (size === this.offset) return [];

    const chunk = Buffer.alloc(size - this.offset);
    const chunkOffset = this.offset;
    const fd = fs.openSync(this.file, 'r');
    fs.readSync(fd, chunk, 0, chunk.length, this.offset);
    fs.closeSync(fd);
    this.offset = size;

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
