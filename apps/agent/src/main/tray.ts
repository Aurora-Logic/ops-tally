import { Menu, Tray, nativeImage } from 'electron';

export type TrayState = 'ok' | 'warn' | 'down' | 'paused';

const COLORS: Record<TrayState, [number, number, number]> = {
  ok: [0x22, 0xc5, 0x5e], // green
  warn: [0xea, 0xb3, 0x08], // yellow
  down: [0xef, 0x44, 0x44], // red
  paused: [0x9c, 0xa3, 0xaf], // grey
};

/** Build a 16x16 filled-circle tray icon in the given state color — no asset files. */
function iconFor(state: TrayState): Electron.NativeImage {
  const size = 16;
  const [r, g, b] = COLORS[state];
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2 - 0.5;
  const cy = size / 2 - 0.5;
  const radius = 6.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dist = Math.hypot(x - cx, y - cy);
      const alpha = dist <= radius ? 255 : dist <= radius + 1 ? Math.round(255 * (radius + 1 - dist)) : 0;
      // BGRA order
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = alpha;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export interface TrayActions {
  openSettings: () => void;
  togglePause: () => void;
  syncNow: () => void;
  quit: () => void;
  isPaused: () => boolean;
}

export class AgentTray {
  private tray: Tray;
  private actions: TrayActions;

  constructor(actions: TrayActions) {
    this.actions = actions;
    this.tray = new Tray(iconFor('paused'));
    this.tray.setToolTip('OpsTally Agent');
    this.tray.on('double-click', actions.openSettings);
    this.rebuildMenu();
  }

  setState(state: TrayState, tooltip?: string): void {
    this.tray.setImage(iconFor(state));
    this.tray.setToolTip(tooltip ? `OpsTally Agent — ${tooltip}` : 'OpsTally Agent');
    this.rebuildMenu();
  }

  private rebuildMenu(): void {
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Settings', click: this.actions.openSettings },
        {
          label: this.actions.isPaused() ? 'Resume' : 'Pause',
          click: () => {
            this.actions.togglePause();
            this.rebuildMenu();
          },
        },
        { label: 'Sync Now', click: this.actions.syncNow },
        { type: 'separator' },
        { label: 'Quit', click: this.actions.quit },
      ])
    );
  }

  destroy(): void {
    this.tray.destroy();
  }
}
