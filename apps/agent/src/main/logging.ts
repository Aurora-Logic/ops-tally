import log from 'electron-log/main';

/**
 * Disk logging for a headless background agent — the tray app runs with no
 * visible window, so the log file is the primary troubleshooting artifact.
 * Writes to %APPDATA%/opstally-agent/logs/main.log, size-rotated: on reaching
 * maxSize the file is archived to main.old.log and a fresh one starts.
 */
export function initLogging(): typeof log {
  log.initialize();
  log.transports.file.level = 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.console.level = 'info';
  // Uncaught exceptions/rejections land in the file instead of vanishing.
  log.errorHandler.startCatching();
  return log;
}

export { log };
