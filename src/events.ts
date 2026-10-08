import { EventEmitter } from 'node:events';

/**
 * Everything the app wants to show, in either mode, goes through this bus.
 * The terminal prints it; the web UI streams it to the browser.
 */
export type AppEvent =
  | { type: 'log'; level: 'info' | 'ok' | 'warn' | 'error'; text: string }
  | { type: 'http'; method: string; path: string; rpc?: string; idTokenSent: boolean; status: number; challenge?: string; target: 'mcp' | 'auth' }
  | { type: 'assistant'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; text: string; isError: boolean }
  | { type: 'turn_done' }
  | { type: 'status' };

class AppEventBus extends EventEmitter {
  emitEvent(event: AppEvent): void {
    this.emit('event', event);
  }
  onEvent(listener: (event: AppEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const bus = new AppEventBus();
bus.setMaxListeners(50);
