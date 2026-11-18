import { BackendManager } from './backend-manager.js';
import { createTools } from './tools.js';
import { createHandlers, ROOT } from './routes.js';
import { ExpertCreationService } from './expert-creation.js';
import { SectorAnalysisService } from './sector-analysis.js';
import { StockAnalysisService } from './stock-analysis.js';
import { WatchlistAnalysisService } from './watchlist-analysis.js';
import { SelectionAnalysisService } from './selection-analysis.js';

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
        // Analysis sessions run local Python/shell helpers, so pin the deployment's
        // full-access preset on the session we just created; every other session
        // keeps whatever the user selected.
        const applyPermission = sessionId => {
          const presets = optional('permissionPresets');
          const store = optional('sessions');
          if (typeof presets?.set !== 'function' || typeof store?.get !== 'function') return false;
          const pin = session => { presets.set(session, 'danger-full-access'); };
          const live = store.get(sessionId);
          if (live) { pin(live); return true; }
          // Creation may publish just after its receipt; follow the created event once.
          let off; let timer;
          const finish = (settle, value) => { clearTimeout(timer); try { off?.(); } catch {} settle(value); };
          return new Promise((resolve, reject) => {
            timer = setTimeout(() => finish(resolve, false), 1500);
            try {
              off = ctx.on('session/created', session => {
                if (session.id !== sessionId) return;
                try { pin(session); finish(resolve, true); } catch (error) { finish(reject, error); }
              });
            } catch { finish(resolve, false); }
          });
        };
        const expertCreation = new ExpertCreationService({workspaces:optional('workspaceRegistry'),sessions:optional('sessionController'),workingDirectory:optional('workingDirectory')});
        const sectorAnalysis = new SectorAnalysisService({workspaces:optional('workspaceRegistry'),sessions:optional('sessionController'),workingDirectory:optional('workingDirectory'),applyPermission});
        const stockAnalysis = new StockAnalysisService({workspaces:optional('workspaceRegistry'),sessions:optional('sessionController'),workingDirectory:optional('workingDirectory'),applyPermission});
        const watchlistAnalysis = new WatchlistAnalysisService({workspaces:optional('workspaceRegistry'),sessions:optional('sessionController'),workingDirectory:optional('workingDirectory'),applyPermission});
        const selectionAnalysis = new SelectionAnalysisService({workspaces:optional('workspaceRegistry'),sessions:optional('sessionController'),workingDirectory:optional('workingDirectory'),applyPermission});
        for (const definition of createTools(manager,{expertCreation})) {
          try { disposers.push(tools.register(definition)); }
          catch (error) { console.warn('[super-trader] tool registration failed:',definition.name,error.message); }
        }
        const handlers = createHandlers(manager,() => web.getOrigin(),undefined,expertCreation,sectorAnalysis,stockAnalysis,watchlistAnalysis,selectionAnalysis);
        disposers.push(web.register({kind:'exact',path:ROOT+'/base',handler:handlers.base}));
        disposers.push(web.register({kind:'exact',path:ROOT+'/retry',handler:handlers.retry}));
        disposers.push(web.register({kind:'exact',path:ROOT+'/expert-creation',handler:handlers.createExpert}));
        disposers.push(web.register({kind:'exact',path:ROOT+'/sector-analysis',handler:handlers.createSector}));
        disposers.push(web.register({kind:'exact',path:ROOT+'/stock-analysis',handler:handlers.createStock}));
        disposers.push(web.register({kind:'exact',path:ROOT+'/watchlist-analysis',handler:handlers.createWatchlist}));
        disposers.push(web.register({kind:'exact',path:ROOT+'/selection-analysis',handler:handlers.createSelection}));
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
