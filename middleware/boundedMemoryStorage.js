/**
 * Multer storage engine that buffers into memory like memoryStorage(),
 * but aborts while streaming once per-file or aggregate request byte
 * limits are exceeded — so oversized uploads never fully occupy RAM.
 */
'use strict';

const ERROR_CODES = Object.freeze({
  PUBLIC_FILE_TOO_LARGE: 'PUBLIC_FILE_TOO_LARGE',
  UPLOAD_BATCH_TOO_LARGE: 'UPLOAD_BATCH_TOO_LARGE',
});

const STATE_KEY = Symbol.for('nlsite.boundedUploadState');

function createLimitError(code, message, extras = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extras);
  return error;
}

function getState(req) {
  if (!req[STATE_KEY]) {
    req[STATE_KEY] = { totalBytes: 0 };
  }
  return req[STATE_KEY];
}

/**
 * @param {{
 *   resolveMaxFileBytes?: (req: object, file: object) => number,
 *   maxRequestBytes?: number,
 * }} [options]
 */
function boundedMemoryStorage(options = {}) {
  const resolveMaxFileBytes = typeof options.resolveMaxFileBytes === 'function'
    ? options.resolveMaxFileBytes
    : () => Number.POSITIVE_INFINITY;
  const maxRequestBytes = Number.isFinite(Number(options.maxRequestBytes))
    ? Number(options.maxRequestBytes)
    : Number.POSITIVE_INFINITY;

  return {
    _handleFile(req, file, cb) {
      const state = getState(req);
      const maxFileBytes = Number(resolveMaxFileBytes(req, file));
      const safeMaxFile = Number.isFinite(maxFileBytes) && maxFileBytes > 0
        ? maxFileBytes
        : Number.POSITIVE_INFINITY;

      const chunks = [];
      let fileBytes = 0;
      let settled = false;

      function cleanupListeners() {
        file.stream.removeListener('data', onData);
        file.stream.removeListener('limit', onLimit);
        file.stream.removeListener('error', onError);
        file.stream.removeListener('end', onEnd);
      }

      function finish(error, info) {
        if (settled) return;
        settled = true;
        cleanupListeners();
        chunks.length = 0;
        if (error) return cb(error);
        return cb(null, info);
      }

      function abort(error) {
        if (settled) return;
        // Settle Multer first so callers always see the limit error once.
        finish(error);
        try {
          file.stream.destroy();
        } catch {
          // ignore destroy failures
        }
        try {
          file.stream.resume();
        } catch {
          // ignore
        }
      }

      function onData(chunk) {
        if (settled) return;
        const length = chunk.length;
        const nextFileBytes = fileBytes + length;
        if (nextFileBytes > safeMaxFile) {
          return abort(createLimitError(
            ERROR_CODES.PUBLIC_FILE_TOO_LARGE,
            'El archivo supera el límite permitido.',
            {
              field: file.fieldname,
              mimetype: file.mimetype,
              maxBytes: safeMaxFile,
              receivedBytes: nextFileBytes,
            }
          ));
        }
        if (state.totalBytes + nextFileBytes > maxRequestBytes) {
          return abort(createLimitError(
            ERROR_CODES.UPLOAD_BATCH_TOO_LARGE,
            'La carga supera el límite total permitido.',
            {
              field: file.fieldname,
              mimetype: file.mimetype,
              maxBytes: maxRequestBytes,
              receivedBytes: state.totalBytes + nextFileBytes,
            }
          ));
        }
        fileBytes = nextFileBytes;
        chunks.push(chunk);
      }

      function onLimit() {
        abort(createLimitError(
          ERROR_CODES.PUBLIC_FILE_TOO_LARGE,
          'El archivo supera el límite permitido.',
          {
            field: file.fieldname,
            mimetype: file.mimetype,
            maxBytes: safeMaxFile,
          }
        ));
      }

      function onError(error) {
        if (settled) return;
        finish(error);
      }

      function onEnd() {
        if (settled) return;
        state.totalBytes += fileBytes;
        const buffer = Buffer.concat(chunks, fileBytes);
        chunks.length = 0;
        finish(null, {
          buffer,
          size: buffer.length,
        });
      }

      file.stream.on('data', onData);
      file.stream.on('limit', onLimit);
      file.stream.on('error', onError);
      file.stream.on('end', onEnd);
    },

    _removeFile(_req, file, cb) {
      delete file.buffer;
      cb(null);
    },
  };
}

module.exports = {
  boundedMemoryStorage,
  ERROR_CODES,
  createLimitError,
};
