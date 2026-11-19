"""服务容器：集中构造所有服务，便于 app 与测试共享同一套依赖。"""
from __future__ import annotations

from threading import Event, Thread

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
from .review import ReviewService
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
        self.jobs = JobManager(self.db)
        self.review = ReviewService(self.db, self.market, self.jobs, model=self.model)
        self.jobs.on_completed = self._archive_selection
        self._review_stop = Event()
        self._review_worker = None
        self.experts = ExpertService(self.db, self.engine, self.model, self.market, review_provider=self.review)
        self.factor_research = FactorResearchService(self.factors, self.model, self.jobs, self.db)
        self.watchlist = WatchlistService(self.db, self.engine, self.experts, self.jobs, market=self.market, review_provider=self.review)
        self.research = ResearchService(self.engine, self.market, self.experts, self.jobs, self.watchlist,
                                        factor_provider=self.factor_research, review_provider=self.review)
        self.selection = SelectionService(self.market, self.research, self.experts, self.jobs, self.watchlist, review_provider=self.review)
        self.journal = JournalService(self.db, self.engine)
        self.memory = MemoryService(self.db)
        self.agent = AgentService(self.plugins, self.engine, self.experts,
                                  self.watchlist, self.model, self.memory)

    def _archive_selection(self, job_type: str, job_id: str) -> None:
        if job_type == "expert_selection":
            self.review.archive(job_id)

    def start_review_maintenance(self) -> None:
        if self._review_worker is not None:
            return
        def run():
            interval = 15
            while not self._review_stop.wait(interval):
                try:
                    self.review.sync(limit=8)
                    self.review.refresh_due(max_targets=2)
                    # Close-of-day AI pass; it no-ops outside the window and
                    # judges each unresolved plan at most once per trading day.
                    self.review.auto_judge_due(max_plans=6)
                except Exception:
                    # A temporary data failure leaves the last verified snapshot intact.
                    pass
                interval = 300
        self._review_worker = Thread(target=run, name="review-refresh", daemon=True)
        self._review_worker.start()

    def close(self) -> None:
        self._review_stop.set()
        if self._review_worker is not None:
            self._review_worker.join()
        self.jobs.shutdown()
        self.market.close()
        self.db.close()
