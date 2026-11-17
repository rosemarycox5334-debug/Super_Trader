"""服务容器：集中构造所有服务，便于 app 与测试共享同一套依赖。"""
from __future__ import annotations

from pathlib import Path

from .agent import AgentService
from .db import Database
from .experts import ExpertService
from .jobs import JobManager
from .factors.service import FactorService
from .factors.research import FactorResearchService
from .journal import JournalService
from .memory import MemoryService
from .market import MarketService
from .model_gateway import ModelClient
from .plugins import PluginService
from .quant import QuantEngine, get_engine
from .settings import Settings, get_settings
from .research import ResearchService
from .selection import SelectionService
from .watchlist import WatchlistService


class Services:
    def __init__(self, settings: Settings | None = None,
                 engine: QuantEngine | None = None):
        self.settings = settings or get_settings()
        self.db = Database(self.settings.state_db)
        self.engine = engine or get_engine()
        self.model = ModelClient(self.settings.model)
        self.market = MarketService()
        self.factors = FactorService()
        self.plugins = PluginService(self.db)
        self.experts = ExpertService(self.db, self.engine, self.model, self.market)
        self.jobs = JobManager(self.db)
        self.factor_research = FactorResearchService(self.factors, self.model, self.jobs, self.db)
        self.watchlist = WatchlistService(self.db, self.engine, self.experts, self.jobs, market=self.market)
        self.research = ResearchService(self.engine, self.market, self.experts, self.jobs, self.watchlist, factor_provider=self.factor_research)
        self.selection = SelectionService(self.market, self.research, self.experts, self.jobs, self.watchlist)
        self.journal = JournalService(self.db, self.engine)
        self.memory = MemoryService(self.db)
        self.agent = AgentService(self.plugins, self.engine, self.experts,
                                  self.watchlist, self.model, self.memory)

    def close(self) -> None:
        self.jobs.shutdown()
        self.market.close()
        self.db.close()
