import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, an error thrown while rendering one tab (e.g. a preload
 * bridge method missing because main/preload weren't restarted after an
 * update — only the renderer hot-reloads) unmounts the whole app to a blank
 * white window, with no nav left to click back out of it.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] tab crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="max-w-lg space-y-2 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">This tab failed to load.</p>
          <p>{this.state.error.message}</p>
          <p className="text-red-600">
            If you just updated the Agent, fully quit it from the tray icon and reopen it — main-process and
            bridge changes need a restart, unlike the rest of the UI.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
