import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { TallyClient } from '@opstally/tally-client';
import { AgentDb } from './engine/db.js';
import { Poller, type PollerStatus } from './engine/poller.js';
import { Dispatcher, type DispatcherStatus } from './dispatcher/sender.js';
import { ensureSecret, getConfig, getSecret, updateConfig } from './config.js';
import { AgentTray, type TrayState } from './tray.js';
import { registerIpc } from './ipc.js';
import { initLogging, log } from './logging.js';
import { initAutoUpdate } from './updater.js';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  initLogging();
  log.info(`[agent] starting v${app.getVersion()}`);

  let win: BrowserWindow | null = null;
  let tray: AgentTray | null = null;
  let quitting = false;

  const db = new AgentDb(join(app.getPath('userData'), 'agent.db'), (reason) =>
    log.error(`[db] corruption detected, recovered with fresh database: ${reason}`)
  );
  const client = new TallyClient();

  let pollerStatus: PollerStatus = { state: 'idle' };
  let dispatcherStatus: DispatcherStatus = { state: 'idle' };

  function broadcastStatus(): void {
    const cfg = getConfig();
    const stats = db.queueStats();
    let state: TrayState = 'ok';
    let tip = 'connected';
    if (cfg.paused) {
      state = 'paused';
      tip = 'paused';
    } else if (pollerStatus.state === 'tally_down') {
      state = 'down';
      tip = pollerStatus.message ?? 'Tally not reachable';
    } else if (pollerStatus.state === 'error' || dispatcherStatus.state === 'retrying') {
      state = 'warn';
      tip = pollerStatus.message ?? dispatcherStatus.message ?? 'retrying';
    } else if (dispatcherStatus.state === 'no_webhook') {
      state = 'warn';
      tip = 'webhook not configured';
    }
    tray?.setState(state, tip);
    win?.webContents.send('status', {
      poller: pollerStatus,
      dispatcher: dispatcherStatus,
      queue: stats,
      trayState: state,
    });
  }

  const dispatcher = new Dispatcher({
    db,
    getSettings: () => ({ webhookUrl: getConfig().webhookUrl, secret: getSecret() }),
    onStatus: (s) => {
      if (s.state !== dispatcherStatus.state || s.message !== dispatcherStatus.message) {
        log.info(`[dispatcher] ${s.state}${s.message ? ` — ${s.message}` : ''}`);
      }
      dispatcherStatus = s;
      broadcastStatus();
    },
    agentVersion: app.getVersion(),
  });

  const poller = new Poller({
    db,
    client,
    getSettings: () => {
      const cfg = getConfig();
      return {
        company: cfg.company,
        tallyHost: cfg.tallyHost,
        tallyPort: cfg.tallyPort,
        paused: cfg.paused,
        voucherLookbackDays: cfg.voucherLookbackDays,
        intervalsMinutes: cfg.intervalsMinutes,
        webhookUrl: cfg.webhookUrl,
      };
    },
    onEvents: (events) => {
      log.info(`[poller] ${events.length} new event(s): ${events.map((e) => e.event).join(', ')}`);
      dispatcher.wake();
    },
    onStatus: (s) => {
      if (s.state !== pollerStatus.state || s.message !== pollerStatus.message) {
        log.info(`[poller] ${s.state}${s.message ? ` — ${s.message}` : ''}`);
      }
      pollerStatus = s;
      broadcastStatus();
    },
  });

  function createWindow(): void {
    if (win) {
      win.show();
      win.focus();
      return;
    }
    win = new BrowserWindow({
      width: 860,
      height: 620,
      title: 'OpsTally Agent',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.mjs'),
        sandbox: false,
      },
    });
    win.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        win?.hide();
      }
    });
    win.on('closed', () => (win = null));
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
    }
  }

  app.on('second-instance', createWindow);

  void app.whenReady().then(() => {
    ensureSecret();
    app.setLoginItemSettings({ openAtLogin: getConfig().openAtLogin });

    tray = new AgentTray({
      openSettings: createWindow,
      togglePause: () => {
        updateConfig({ paused: !getConfig().paused });
        broadcastStatus();
      },
      syncNow: () => void poller.pollAll(),
      quit: () => {
        quitting = true;
        app.quit();
      },
      isPaused: () => getConfig().paused,
    });

    registerIpc({ db, client, poller, dispatcher, broadcastStatus });

    poller.start();
    dispatcher.start();
    broadcastStatus();
    void initAutoUpdate();

    // First run (no webhook configured yet): open settings so the user can set up.
    if (!getConfig().webhookUrl) createWindow();
  });

  app.on('window-all-closed', () => {
    // Keep running in the tray; explicit Quit exits.
  });

  app.on('before-quit', () => {
    quitting = true;
    poller.stop();
    dispatcher.stop();
  });
}
