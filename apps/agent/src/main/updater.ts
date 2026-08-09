import { app } from 'electron';
import { log } from './logging.js';

/**
 * Auto-update scaffold. DORMANT until two prerequisites exist:
 *   1. A `publish` target in electron-builder.yml (GitHub Releases or S3) —
 *      builds then embed app-update.yml, which electron-updater requires.
 *   2. Code-signed builds — Windows auto-update of an unsigned app is blocked
 *      by the installer and is a security hole besides.
 * Until then this logs one line and does nothing.
 */
export async function initAutoUpdate(): Promise<void> {
  if (!app.isPackaged) {
    log.info('[updater] dev mode — auto-update disabled');
    return;
  }
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.logger = log;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    await autoUpdater.checkForUpdatesAndNotify();
    // Re-check every 6 hours while the agent stays resident in the tray.
    setInterval(() => void autoUpdater.checkForUpdatesAndNotify(), 6 * 3600 * 1000);
  } catch (err: any) {
    // Missing app-update.yml (no publish target configured) lands here — expected until v2 infra exists.
    log.info(`[updater] not active: ${err.message}`);
  }
}
