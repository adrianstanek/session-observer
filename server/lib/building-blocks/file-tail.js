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
    this.unfinishedLine = '';
  }

  readNewLines() {
    let size;
    try { size = fs.statSync(this.file).size; } catch { return []; }
    if (size < this.offset) this.reset(); // the file was truncated or cleared
    if (size === this.offset) return [];

    const chunk = Buffer.alloc(size - this.offset);
    const fd = fs.openSync(this.file, 'r');
    fs.readSync(fd, chunk, 0, chunk.length, this.offset);
    fs.closeSync(fd);
    this.offset = size;

    const lines = (this.unfinishedLine + chunk.toString('utf8')).split('\n');
    this.unfinishedLine = lines.pop(); // the last line may still be being written
    return lines;
  }
}

module.exports = { FileTail };
