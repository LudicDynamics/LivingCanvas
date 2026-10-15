// `undici` in browser mode: the global fetch is the transport; dispatcher
// configuration (proxies, keep-alive tuning) has nothing to configure.
class Dispatcher { destroy() { return Promise.resolve(); } close() { return Promise.resolve(); } }
export class Agent extends Dispatcher { constructor(_o?: unknown) { super(); } }
export class EnvHttpProxyAgent extends Agent {}
export class ProxyAgent extends Agent {}
export class Pool extends Agent {}
export class Client extends Agent {}
let dispatcher: unknown = new Agent();
export function setGlobalDispatcher(d: unknown) { dispatcher = d; }
export function getGlobalDispatcher() { return dispatcher; }
export const fetch = (...a: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...a);
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const FormData = globalThis.FormData;
export default { Agent, EnvHttpProxyAgent, ProxyAgent, Pool, Client, setGlobalDispatcher, getGlobalDispatcher, fetch, Headers, Request, Response, FormData };
