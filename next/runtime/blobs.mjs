import { mkdirSync, existsSync, statSync, openSync, closeSync, readSync, writeSync, fsyncSync, renameSync, unlinkSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { LIMITS, blobHash, integer, requireThat } from './contracts.mjs';
/** Immutable content-addressed files. Files are not deleted when a summary succeeds. */
export class Blobs {
    constructor(store) {
        this.store = store;
        this.root = join(store.directory, 'blobs');
        this.staging = join(store.directory, 'uploads');
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
        mkdirSync(this.staging, { recursive: true, mode: 0o700 });
        this.committing = new Map();
    }
    path(hash) { return join(this.root, blobHash(hash)); }
    tempPath(hash) { return join(this.staging, blobHash(hash)); }
    has(hash, size) {
        const row = this.store.db.prepare('SELECT size FROM blobs WHERE hash=?').get(blobHash(hash));
        return !!row && (size === undefined || row.size === size) && existsSync(this.path(hash)) && statSync(this.path(hash)).size === row.size;
    }
    begin({ hash, size }) {
        blobHash(hash);
        integer(size, '文件大小', { max: LIMITS.blob });
        if (this.has(hash, size))
            return { hash, size, offset: size, state: 'verified' };
        const old = this.store.db.prepare('SELECT size FROM uploads WHERE hash=?').get(hash);
        requireThat(!old || old.size === size, 'upload_size_conflict', '已有上传的长度不同', 409);
        this.store.db.prepare('INSERT OR IGNORE INTO uploads VALUES (?,?)').run(hash, size);
        const path = this.tempPath(hash);
        if (!existsSync(path)) {
            const fd = openSync(path, 'wx', 0o600);
            fsyncSync(fd);
            closeSync(fd);
        }
        return { hash, size, offset: statSync(path).size, state: 'uploading' };
    }
    write({ hash, offset, bytes }) {
        blobHash(hash);
        integer(offset, '分块偏移');
        requireThat(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= LIMITS.chunk, 'invalid_chunk', '分块无效');
        const upload = this.store.db.prepare('SELECT size FROM uploads WHERE hash=?').get(hash);
        requireThat(upload, 'unknown_upload', '请先建立上传', 404);
        requireThat(!this.committing.has(hash), 'upload_verifying', '正在校验，暂不接受新分块', 409);
        const current = statSync(this.tempPath(hash)).size;
        requireThat(offset <= current && offset + bytes.length <= upload.size, 'invalid_offset', '分块位置不连续或越界', 409);
        if (offset < current) {
            requireThat(offset + bytes.length <= current, 'partial_overlap', '分块部分重叠，请按已确认偏移续传', 409);
            const fd = openSync(this.tempPath(hash), 'r');
            const old = Buffer.alloc(bytes.length);
            try {
                readSync(fd, old, 0, old.length, offset);
            }
            finally {
                closeSync(fd);
            }
            requireThat(old.equals(bytes), 'chunk_conflict', '已保存分块与重试内容不同', 409);
            return { hash, offset: current, replayed: true };
        }
        const fd = openSync(this.tempPath(hash), 'a');
        try {
            let written = 0;
            while (written < bytes.length)
                written += writeSync(fd, bytes, written, bytes.length - written);
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        return { hash, offset: current + bytes.length };
    }
    async commit(hash) {
        blobHash(hash);
        if (this.has(hash))
            return { hash, state: 'verified' };
        if (this.committing.has(hash))
            return this.committing.get(hash);
        const promise = this.verifyAndCommit(hash);
        this.committing.set(hash, promise);
        try {
            return await promise;
        }
        finally {
            this.committing.delete(hash);
        }
    }
    async verifyAndCommit(hash) {
        const upload = this.store.db.prepare('SELECT size FROM uploads WHERE hash=?').get(hash);
        requireThat(upload, 'unknown_upload', '上传不存在', 404);
        const path = this.tempPath(hash);
        requireThat(statSync(path).size === upload.size, 'upload_incomplete', '附件尚未传完', 409);
        const hasher = createHash('sha256');
        for await (const chunk of createReadStream(path))
            hasher.update(chunk);
        if (hasher.digest('hex') !== hash) {
            // Only the staging file owned by this upload is reset; no committed original is touched.
            unlinkSync(path);
            this.store.db.prepare('DELETE FROM uploads WHERE hash=?').run(hash);
            requireThat(false, 'blob_hash_mismatch', '附件校验失败，暂存内容已清除，请重新上传', 409);
        }
        // Windows FlushFileBuffers requires a write-capable handle, even though
        // this call only flushes bytes that were already written to the file.
        const fd = openSync(path, 'r+');
        try {
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        renameSync(path, this.path(hash));
        // Directory fsync is supported on POSIX; Windows persistence remains a native acceptance gate.
        if (process.platform !== 'win32') {
            const dir = openSync(this.root, 'r');
            try {
                fsyncSync(dir);
            }
            finally {
                closeSync(dir);
            }
        }
        this.store.transaction(() => {
            this.store.db.prepare('INSERT OR REPLACE INTO blobs VALUES (?,?,?)').run(hash, upload.size, Date.now());
            this.store.db.prepare('DELETE FROM uploads WHERE hash=?').run(hash);
        });
        return { hash, size: upload.size, state: 'verified' };
    }
    read({ hash, offset = 0, length = LIMITS.chunk }) {
        requireThat(this.has(hash), 'blob_unavailable', '附件尚未到达或本机文件缺失', 404);
        integer(offset, '偏移');
        integer(length, '长度', { min: 1, max: LIMITS.chunk });
        const size = statSync(this.path(hash)).size;
        requireThat(offset <= size, 'invalid_offset', '读取位置越界', 416);
        const result = Buffer.alloc(Math.min(length, size - offset)), fd = openSync(this.path(hash), 'r');
        try {
            readSync(fd, result, 0, result.length, offset);
        }
        finally {
            closeSync(fd);
        }
        return result;
    }
    missing() { return this.store.attachmentRefs().filter(file => !this.has(file.hash, file.size)); }
}
