// RPC and edge-function handlers are registered by the fixture modules. Anything
// unregistered is logged (window.__demo.misses) so a missing screen shows up in
// verification instead of silently rendering empty.
import { misses } from './postgrest';

export type Handler = (args: any, req: Request) => any | Promise<any>;

export const RPC: Record<string, Handler> = {};
export const FUNCTIONS: Record<string, Handler> = {};

export function onRpc(name: string, fn: Handler) { RPC[name] = fn; }
export function onFunction(name: string, fn: Handler) { FUNCTIONS[name] = fn; }

export function noteMiss(msg: string) {
  if (!misses.includes(msg)) misses.push(msg);
  console.warn('[demo]', msg);
}
