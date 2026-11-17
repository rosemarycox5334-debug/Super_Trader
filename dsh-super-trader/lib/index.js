import { BackendManager } from './backend-manager.js';
import { createTools } from './tools.js';
import { createHandlers, ROOT } from './routes.js';
import { ExpertCreationService } from './expert-creation.js';

export const name = 'super-trader';
export const inject = ['tools', 'webServer'];

// Exported seam for lifecycle tests. No initialization runs at import time.
export function mount(ctx, createManager = () => new BackendManager()) {
  try {
    if (!ctx || typeof ctx.effect !== 'function') return;
    ctx.effect(() => {
      const disposers = [];
      let manager;
      try {
        manager = createManager();
        let tools, web;
        try { tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools; } catch {}
        try { web = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer; } catch {}
        if (!tools?.register || !web?.register) {
          // Malformed/inactive context: do not launch an unreachable process.
          void Promise.resolve(manager.dispose()).catch(() => {});
          return;
        }
        const optional = name => { try { return typeof ctx.get==='function'?ctx.get(name):ctx[name]; } catch {} };
        const expertCreation = new ExpertCreationService({workspaces:optional('workspaceRegistry'),sessions:optional('sessionController'),workingDirectory:optional('workingDirectory')});
        for (const definition of createTools(manager,{expertCreation})) {
          try { disposers.push(tools.register(definition)); }
          catch (error) { console.warn('[super-trader] tool registration failed:',definition.name,error.message); }
        }
        const handlers = createHandlers(manager,() => web.getOrigin(),undefined,expertCreation);
        disposers.push(web.register({kind:'exact',path:ROOT+'/base',handler:handlers.base}));
        disposers.push(web.register({kind:'exact',path:ROOT+'/retry',handler:handlers.retry}));
        disposers.push(web.register({kind:'exact',path:ROOT+'/expert-creation',handler:handlers.createExpert}));
        disposers.push(web.register({kind:'prefix',path:ROOT+'/backend',handler:handlers.proxy}));
        // Crucially not awaited by Cordis apply/effect: slow Python/data load cannot block DSH boot.
        void Promise.resolve().then(() => manager.ensureBackend()).catch(() => {});
      } catch (error) {
        console.warn('[super-trader] initialization degraded:',error.message);
      }
      return async () => {
        for (const dispose of disposers.reverse()) { try { if (typeof dispose === 'function') dispose(); } catch {} }
        try { await manager?.dispose(); } catch {}
      };
    }, 'super-trader: backend, tools and HTTP transport');
  } catch { /* A hostile/missing Host context must not take down the Host. */ }
}
export function apply(ctx) { mount(ctx); }
