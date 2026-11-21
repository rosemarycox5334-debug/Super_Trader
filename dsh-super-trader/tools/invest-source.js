// Declaration-only investment workflow. Inlined by build-client; no model calls on mount.
function investMessages() {
  const base=investMessagesBase(),extra=investDesignMessages();
  return Object.fromEntries(Object.keys(base).map(lang=>[lang,{...base[lang],...extra[lang],...investPriceMessages(lang)}]));
}
function investDesignMessages() {
  return {
    zh:{watchSerial:'序号',watchPrice:'最新价（元）',watchChange:'涨跌幅（%）',watchActions:'操作',watchFilter:'在自选股中查找（名称或代码）',watchCount:'共 {n} 只',watchNoMatch:'没有匹配的自选股。',watchQuoteNote:'行情为接口快照；缺失显示 —，不补零。涨用 +、跌用 −、缺失用 —，同时以红 / 绿区分（A 股惯例，红涨绿跌）。',watchQuoteTime:'行情时间',watchQuoteLoading:'正在取得行情…',watchQuoteFailed:'行情暂不可用，价格与涨跌幅显示为 —。',pickSample:'样本',sampleNote:'以下为成分样本，不代表全板块。'},
    en:{watchSerial:'No.',watchPrice:'Last (CNY)',watchChange:'Change (%)',watchActions:'Actions',watchFilter:'Find in watchlist (name or code)',watchCount:'{n} items',watchNoMatch:'No watchlist item matches.',watchQuoteNote:'Quotes are API snapshots; missing values show — and are never zero. Up is +, down is −, missing is —, with red / green as the A-share convention (red up, green down).',watchQuoteTime:'Quote time',watchQuoteLoading:'Fetching quotes…',watchQuoteFailed:'Quotes unavailable; price and change show —.',pickSample:'Sample',sampleNote:'The list below is a constituent sample, not the whole sector.'}
  };
}
function investPriceMessages(lang) {
  return lang==='zh'?{
    priceCurrent:'当前价格',priceLatest:'最新价',priceClose:'最近收盘价',priceDatedClose:'{m}月{d}日收盘价',priceUnit:'元',
    pricePct:'涨跌幅',priceAmount:'涨跌额',priceUp:'上涨',priceDown:'下跌',priceFlat:'平盘',priceMarketTime:'行情时间（上海）',priceResponseTime:'接口响应时间（上海）',
    priceState:'交易状态',priceTrading:'交易中',priceLunch:'午间休市',pricePre:'未开盘',priceClosed:'已收盘',priceWeekend:'非交易日',priceNoToday:'当日无行情',priceDay:'最新行情日期',priceAbsent:'报价未提供此字段',priceNoRow:'未返回此标的的有效最新价',priceExpired:'已过期'
  }:{
    priceCurrent:'Current price',priceLatest:'Last price',priceClose:'Latest closing price',priceDatedClose:'Closing price · {m}/{d}',priceUnit:'CNY',
    pricePct:'Change (%)',priceAmount:'Price change',priceUp:'Up',priceDown:'Down',priceFlat:'Flat',priceMarketTime:'Market time (Shanghai)',priceResponseTime:'API response time (Shanghai)',
    priceState:'Session',priceTrading:'Trading',priceLunch:'Lunch break',pricePre:'Pre-open',priceClosed:'Closed',priceWeekend:'Non-trading day',priceNoToday:'No quote for today',priceDay:'Latest trading date',priceAbsent:'Field not supplied',priceNoRow:'No valid last price returned for this target',priceExpired:'Stale'
  };
}
function investMessagesBase() {
  return {
    zh:{...investBatchMessages('zh'),factors:'量化因子预测',factorPredict:'单股查询',factorLibrary:'因子库',factorBacktest:'回测详情',factorIntro:'同一时间框架内，h=1–20共用同一条量化因子；不同时间框架可使用不同量化因子。只展示最终预测准确率，不做横截面排名。',factorDisclaimer:'全样本回测，未做样本外；历史准确率不是未来概率，不代表收益或交易指令。',factorCode:'标的代码（6位）',factorTimeframe:'时间框架',factorDaily:'日线',factorFiveMinute:'5分钟',factorHourly:'1小时',factorWeekly:'周线',factorTimeframeMissing:'该周期数据暂未接入',factorQuery:'查询本地回测',factorAccuracy:'最终预测准确率',factorCoverage:'预测覆盖率',factorEvaluated:'有效评估窗口',factorCorrect:'正确窗口',factorSkipped:'跳过窗口',factorNotEvaluated:'未评估窗口',factorBaseline:'单边基准（始终偏多）',factorSameSet:'相同评估集基准',factorRule:'共用量化因子',factorRuleId:'量化因子ID',factorDataDate:'数据截至',factorBars:'历史K线数量',factorDirection:'当前方向',factorNeutral:'中性 / 无方向',factorCurve:'逐窗口准确率（h=1–20）',factorHorizon:'窗口 h',factorNoAccuracy:'无有效窗口（accuracy=null）',factorChartEmpty:'没有有效准确率点，不生成示意曲线。',factorChartNote:'仅绘制接口返回的历史准确率；空值留空，不补零。',factorRuleAccuracy:'量化因子准确率',factorShowRule:'查看当前股票量化因子表现',factorRulesEmpty:'没有返回可用量化因子。',factorRuleOnly:'这里是历次批量挖掘保存的真实量化因子；点击只做本地回测，不调用模型。',factorRulesTotal:'量化因子总数',factorTargets:'覆盖标的',factorRuleCreated:'创建时间',factorThinSample:'样本少/覆盖低',factorTopAccuracy:'最高准确率标的',factorEliminated:'已淘汰',factorAvgAccuracy:'历史回测该量化因子平均准确率',factorHistCoverage:'历史回测该量化因子预测覆盖率（不为中性率）',factorTopCoverage:'最高覆盖率标的',factorRuleSummaryMissing:'模型未提供策略说明',factorNoReport:'暂无本地回测数据。可输入股票代码后查询。',factorNoBacktest:'选择一条真实量化因子后查看回测详情。',factorConfusion:'方向混淆表',factorPredicted:'预测方向',factorActualUp:'实际上涨',factorActualDown:'实际下跌',factorActualFlat:'实际持平',factorFalsePositive:'假阳性样本',factorFalseNegative:'假阴性样本',factorSampleDate:'样本日期',factorReturn:'窗口收益',factorSamplesEmpty:'本次未返回此类样本。',factorSamplesMissing:'接口未提供样本明细。',factorEvolveLater:'自进化采集下一阶段接入',factorInvalidTimeframe:'该周期数据暂未接入，仅支持日线。',factorApiUnavailable:'因子接口暂不可用',selectionResearching:'正在研究，尚未形成名单。',selectionAllowedStocks:'允许探索的股票数',selectionDirectorySeen:'实际浏览目录条目',selectionResearched:'深入研究股票',selectionEntries:'条',selectionStocks:'只',selectionSourceTime:'来源接口时间',selectionFact:'引用事实',selectionInvalidRef:'引用指针失效、不可用或不是事实叶节点，无法核实该引用。',selectionNullValue:'null（未取得数值，不补零）',selectionFiscalPeriod:'财务报告期',selectionPeriodEnd:'报告期末',selectionDisclosed:'披露日',selectionDirection:'方向',selectionDirectionNeutral:'中性',selectionSupplement:'来源数据摘要（补充）',jobInterrupted:'任务已中断（如服务重启）；未完成，不会继续自动检查。',selectionSomeFailed:'任务已结束，但部分专家失败 / 未完成；仅保留实际返回的独立研究。',selectionQuantNotRequested:'未调用量化（不影响入选）',selectionQuantUnavailable:'量化不可用（不影响入选）',selectionQuantAvailable:'量化已取得，仅作辅助',selectionIntro:'专家各自按理念自主找候选、查数据与选股；基本面与量化仅是可调用的辅助工具，不预设量化候选或固定财务阈值。任务有预算限制，并非全市场逐股扫描。',selectionStyle:'AI风格专家，非本人',selectionBrief:'偏好说明（可选，不是硬编码筛选条件）',selectionBriefHint:'自由描述你的研究偏好，最多1000字；无需代码、未来第N天或财务阈值。',selectionStart:'开始专家选股（调用模型，可能计费）',selectionParameters:'本任务冻结参数',selectionChanged:'当前表单已变更；下方仍为原任务，不代表新请求。原任务结束前不会重复提交。',selectionNames:'本任务专家',selectionLimit:'每位专家最多候选',selectionNoBrief:'未填写偏好',selectionMissingSector:'请先到板块页选择板块，再开始选股。',selectionBriefLong:'偏好说明不能超过1000字。',selectionPollPaused:'已暂停自动检查（最长10分钟 / 300次）。保留任务ID，后台未被停止，可手动继续检查。',selectionPartial:'阶段性研究，任务尚未结束；名单可能继续变化。',selectionOnlyResearch:'仅为独立研究候选，不是买入指令。量化缺失不淘汰，不以历史命中率评分。',selectionApproach:'自主研究思路',selectionPicks:'独立候选名单',selectionNoPicks:'本专家没有入选候选，不补齐、不凑数。',selectionPending:'等待专家返回独立研究结果。',selectionFit:'与专家理念的契合点',selectionMissing:'缺失证据',selectionRejected:'未入选与理由',selectionCoverage:'实际研究覆盖',selectionCommon:'共同关注',selectionDifferences:'名单差异',selectionCompareNote:'交集与差异只描述独立名单，不是统一投票、胜率或上涨概率。',selectionNoCommon:'暂无共同候选。',selectionNoDifferences:'暂无名单差异。',selectionActivity:'专家取数与研究进度',selectionErrors:'专家失败 / 未完成',selectionEvidenceMissing:'未找到对应证据来源，不能据此视为已核实。',selectionEvidenceSummary:'数据摘要',selectionUniverse:'可选范围目录',selectionNone:'任务没有返回任何专家名单，不能视为成功选股。',selectionCancelWait:'取消请求仍在等待HTTP返回；在途模型/取数不保证立即停止，不会下单。',selectionExpertsUnavailable:'没有可用专家。请检查专家配置后重试。',selectionNoRisks:'未提供风险说明，不代表没有风险。',stockLookup:'股票/ETF名称或代码',lookupHint:'输入名称查找，或直接输入6位代码；请选择“查找股票”或“查找基金”（基金含 ETF 与 LOF）。无需选择未来某一天。',confidenceLow:'低',confidenceMedium:'中',confidenceHigh:'高',decisionUp:'偏多共识',decisionDown:'偏空共识',decisionNone:'暂未形成共识',evidenceCoverage:'专家可用证据',financials:'财务报表',valuations:'估值指标',newsEvidence:'新闻证据',covered:'已取得',notAvailable:'未取得',screen:'专家选股',stock:'个股/ETF分析',sectors:'板块分析',experts:'专家团队',watchlist:'自选股',journal:'研究记录',settings:'数据与设置',sectorAi:'AI 板块分析',sectorAiHelp:'点击后会在「Ai板块分析」工作区新建独立会话，由 AI 读取真实板块报告并在该会话中分析；本页不再展示原始行情表格。',sectorAiStart:'开始 AI 板块分析',stockAiStart:'开始 AI 个股分析',stockAiRunning:'正在创建会话',stockAiHelp:'点击后会在「Ai个股分析」工作区新建独立会话，由 AI 读取真实个股报告、调用全部启用专家，并逐位展示理由、依据、情景和风险。',stockAiOpen:'打开个股分析会话',sectorAiRunning:'正在创建会话',sectorAiOpen:'打开分析会话',sectorAiAccepted:'分析会话已创建并自动打开；AI 正在该会话中分析。',sectorAiSessionReady:'会话已创建，若未自动打开可点击打开。',sectorAiExperts:'调整专家',sectorAiNoExperts:'没有启用的专家，请先到专家团队选择。',sectorAiOther:'当前显示的是其他研究对象的结果。',workflow:'先找机会，再读走势，最后听取团队的条件判断。',disclaimer:'仅供投研，不下单、不承诺收益。历史内样本命中率不是校准的未来概率；专家多数票也不是上涨概率。',trendStyle:'趋势共振',watchStyle:'偏多观察',scope:'选股范围',market:'全A股',marketScope:'默认全A股目录，专家自主发现候选。',watchScope:'我的自选股',sectorScope:'选中板块的全部成分股',cutoff:'历史数据截至',unknown:'未知',source:'来源',startScreen:'开始选股',screenHelp:'选择真实专家与可选偏好，确认费用后开始。页面不会自动调用模型。',screenIdle:'尚未开始专家选股。默认范围为全A股。',screenEmpty:'没有入选候选，不补齐、不凑数。',pool:'覆盖池',matched:'符合条件',reason:'入选理由',signals:'多周期信号',research:'研究这只',addWatch:'加入自选',added:'已加入自选',code:'股票代码',codeHint:'直接输入 6 位 A 股代码，无需先命中本地历史库。',searchStock:'按名称找股票',findStock:'查找股票',findEtf:'查找ETF',findFund:'查找基金',stockSearchEmpty:'没有匹配的股票。',brief:'查看趋势简报',briefHelp:'查询个股或场内基金，查看持续刷新的价格，或打开专家会话研究走势。',emptyBrief:'输入代码，查看真实证据；本地量化未覆盖不影响独立行情展示。',quote:'行情快照',history:'真实日K与成交量',structure:'价量结构',quant:'5 / 10 / 20 多周期量化',agreement:'信号一致性',bullish:'多周期偏多',bearish:'多周期偏空',mixed:'周期有分歧',neutral:'无方向信号',unavailable:'不可用',up:'偏多',down:'偏空',range:'震荡',signalZero:'无方向 · 命中率为 null',hitRate:'量化因子历史命中率（内样本）',samples:'历史样本',coverage:'覆盖率',period:'周期',cycle:'交易日尺度',notCovered:'本地量化未覆盖此对象，不以同号股票替代。',lastPrice:'最新价',change:'涨跌幅',quoteTime:'行情接口快照时间',apiTime:'K线接口时间',snapshotNote:'接口时间不是逐笔成交时间；行情和历史信号可能不同步。',stale:'历史信号早于行情日期；不是实时信号。',ma5:'MA5',ma20:'MA20',ma60:'MA60',return5:'近5日涨跌',return20:'近20日涨跌',lowReference:'20日低点参考',resistance:'20日高点参考',volumeRatio:'量比',forward:'前复权',unadjusted:'指数，无复权',chartEmpty:'暂无有效真实K线，不生成示意或未来K线。',chartLegend:'图例：↑ 收盘≥开盘；↓ 收盘<开盘；下方柱为成交量。仅绘制已取得的历史数据。',volume:'成交量',bars:'根',teamNext:'请专家团队分析走势',teamNextHelp:'直接使用全部启用专家，新建「Ai个股分析」会话并自动打开；会调用模型并可能产生费用。',draft:'带入 Super Trader 草稿',draftHelp:'只准备草稿，需你检查后发送，不自动调用模型。',draftReady:'Super Trader 草稿已准备，尚未发送或调用模型。',copyDraft:'可手动复制的只读证据',industry:'行业',concept:'概念',sectorSearch:'搜索板块名称',findSector:'查找板块',chooseSector:'选择一个板块，使用完整板块代码取得证据。',noSectors:'没有匹配板块。',constituents:'成分股',breadth:'成分股涨跌分布',breadthSample:'样本 / 全部成分',rising:'上涨',falling:'下跌',flat:'平盘',missing:'缺失',screenSector:'以此板块成分选股',previous:'上一页',next:'下一页',teamIntro:'AI风格专家，非本人。团队结合行情、价量结构和多周期量化证据，讨论整体走势、多空条件及风险，不猜某一天涨跌。',currentTarget:'当前研究对象',chooseTarget:'先在个股分析或板块分析选择对象，再带到这里。',selectExperts:'选择参与专家',noExperts:'尚无可用的真实专家配置。',cost:'点击下方按钮将调用已配置模型，可能产生 API 费用；仅在你点击后提交，不自动重试提交。',startTeam:'确认费用并开始团队分析',submitting:'正在提交研究任务…',submitted:'任务已提交，不代表分析完成。',job:'研究任务',progress:'进度',cancel:'取消本次研究',cancelHelp:'取消仅停止这项研究，不会发送任何证券订单。',continueCheck:'继续检查任务',pollPaused:'自动检查已暂停（最长5分钟 / 150次）。点击继续检查，不会重新提交。',jobOther:'下方任务属于另一个研究对象，不是当前对象的新结论。',resultTarget:'报告研究对象',reportTime:'证据生成时间',teamView:'团队观点与分歧',support:'有效票支持比例',voteNote:'支持比例只是有效票中的一致程度，不是胜率或上涨概率。',votesUp:'偏多票',votesDown:'偏空票',abstained:'弃权',shortTerm:'短期走势',mediumTerm:'中期走势',bullCase:'偏多成立条件',bearCase:'偏空成立条件',invalidation:'失效条件',risks:'主要风险',evidence:'证据来源与引用',noEvidence:'没有可核验的证据，不补造专家结论。',errors:'分源问题',loading:'正在取得真实数据…',retry:'重试',requestFailed:'请求未完成',invalidCode:'请输入有效的6位股票代码',invalidSector:'请选择完整板块代码（如 881...TI）',invalidResponse:'接口响应与研究对象不一致或格式无效',consentRequired:'请明确确认模型费用后开始',selectExpert:'请至少选择一位可用专家',activeJob:'已有研究任务，请先查看或取消，避免重复收费',backChat:'返回 Super Trader 对话',connected:'后端已就绪',offline:'后端暂不可用',retryStart:'重试连接',advanced:'高级历史研究',advancedNote:'旧四页仅用于高级历史研究；其中的单周期参数不是主流程的未来走势判断。',quantTab:'历史量化',refresh:'刷新',watchEmpty:'暂无自选股。先从选股结果或个股简报加入。',watchHelp:'选择一只股票进入完整趋势简报。',disabledExpert:'未启用',jobRunning:'正在分析',jobCompleted:'已完成',jobFailed:'失败',jobCancelled:'已取消',jobQueued:'排队中',cancelPending:'正在取消…',expertTraits:'特点',expertNew:'新建专家',expertDelete:'删除',expertDeleteQuestion:'确定删除专家',expertDeleteNote:'删除后保存的分析历史仍保留；需要恢复只能重新创建。',expertDeleteConfirm:'确认删除',expertDeleting:'正在删除…',expertAiRequirement:'想新建什么专家？',expertAiExample:'例如：我想新建一个参考 B 站北京炒家公开交易理念的专家',expertAiHelp:'系统会复用或创建“新建专家”工作区，每次新建独立会话。AI 必须先真实联网搜索、读取并引用来源，再整理方法论；无法联网或资料不足时不会凭记忆保存。',expertAiCost:'点击后会启动 Super Trader AI 会话，可能产生模型费用；研究进度和需要补充的信息会显示在新会话中。',expertAiStart:'开始 AI 创建',expertAiAccepted:'AI 已受理创建任务，不代表专家已保存；请在新会话查看结果，返回后刷新专家列表。',expertAiSessionReady:'会话已创建，但任务尚未确认受理，可重试原请求或打开会话查看。',expertAiOpen:'打开创建会话',expertCreate:'创建专家',expertToolsHint:'工具（每行一个）',expertMethod:'方法论（系统提示词）',expertEdit:'编辑',expertSave:'保存',expertCancel:'取消',expertName:'名称',expertTag:'特点',expertCriteria:'分析视角（每行一条）',expertSystemPrompt:'方法论（系统提示词）',expertModel:'模型',expertTools:'证据工具',criteria:'分析视角',reportEvidence:'本次团队使用的量化与行情证据',confidence:'模型自报信心（未校准）',decision:'共识方向',allSignals:'每个周期独立计算，缺失与无方向不补造数值。',screenSignals:'偏多 / 偏空周期数',openStock:'进入个股分析',openSector:'进入板块分析',scopeMissing:'先在板块分析选择一个板块。',notStarted:'未开始',cancelled:'已停止本次研究',noRisk:'未返回具体风险；不代表无风险。'},
    en:{...investBatchMessages('en'),factors:'Quant factor prediction',factorPredict:'Single-target query',factorLibrary:'Factor library',factorBacktest:'Backtest details',factorIntro:'One rule is shared across h=1–20 within a timeframe; other timeframes may use different rules. Final prediction accuracy only, with no cross-sectional ranking.',factorDisclaimer:'Full-sample backtest, not out-of-sample. Historical accuracy is not a future probability, return promise or trade instruction.',factorCode:'Target code (6 digits)',factorTimeframe:'Timeframe',factorDaily:'Daily',factorFiveMinute:'5 minutes',factorHourly:'1 hour',factorWeekly:'Weekly',factorTimeframeMissing:'Timeframe data not connected yet',factorQuery:'Query local backtest',factorAccuracy:'Final prediction accuracy',factorCoverage:'Prediction coverage',factorEvaluated:'Evaluated windows',factorCorrect:'Correct windows',factorSkipped:'Skipped windows',factorNotEvaluated:'Unevaluated windows',factorBaseline:'One-sided baseline (always up)',factorSameSet:'Same-evaluation-set baseline',factorRule:'Shared rule',factorRuleId:'Rule ID',factorDataDate:'Data as of',factorBars:'Historical candles',factorDirection:'Current direction',factorNeutral:'Neutral / no direction',factorCurve:'Accuracy by horizon (h=1–20)',factorHorizon:'Horizon h',factorNoAccuracy:'No evaluable accuracy (null)',factorChartEmpty:'No valid accuracy points. No illustrative curve is generated.',factorChartNote:'Only observed historical accuracy is drawn. Nulls remain gaps, not zeroes.',factorRuleAccuracy:'Rule accuracy',factorShowRule:'View rule on current stock',factorRulesEmpty:'No available rules returned.',factorRuleOnly:'Real rules saved by earlier batch mining; clicking only runs a local backtest with no model calls.',factorRulesTotal:'Rules',factorTargets:'Targets covered',factorRuleCreated:'Created',factorThinSample:'thin sample/low coverage',factorTopAccuracy:'Top-accuracy target',factorEliminated:'Eliminated',factorAvgAccuracy:'Historical average accuracy',factorHistCoverage:'Historical prediction coverage (neutral excluded)',factorTopCoverage:'Top-coverage target',factorRuleSummaryMissing:'No strategy summary provided by the model',factorNoReport:'No local backtest data. Enter a stock code to query.',factorNoBacktest:'Choose a real rule to view backtest details.',factorConfusion:'Direction confusion table',factorPredicted:'Predicted direction',factorActualUp:'Actually up',factorActualDown:'Actually down',factorActualFlat:'Actually flat',factorFalsePositive:'False-positive samples',factorFalseNegative:'False-negative samples',factorSampleDate:'Sample date',factorReturn:'Window return',factorSamplesEmpty:'No samples of this type returned.',factorSamplesMissing:'The interface did not provide sample details.',factorEvolveLater:'Self-evolution collection will be connected in a later stage',factorInvalidTimeframe:'Timeframe data not connected; only daily data is supported.',factorApiUnavailable:'Factor endpoint unavailable',selectionResearching:'Research in progress; no candidate list formed yet.',selectionAllowedStocks:'Stocks permitted for exploration',selectionDirectorySeen:'Directory entries actually browsed',selectionResearched:'Stocks researched in depth',selectionEntries:'entries',selectionStocks:'stocks',selectionSourceTime:'Source interface timestamp',selectionFact:'Cited fact',selectionInvalidRef:'The pointer is invalid, unavailable or not a factual leaf. This citation cannot be verified.',selectionNullValue:'null (value unavailable, not replaced with zero)',selectionFiscalPeriod:'Fiscal reporting period',selectionPeriodEnd:'Reporting period end',selectionDisclosed:'Disclosure date',selectionDirection:'Direction',selectionDirectionNeutral:'Neutral',selectionSupplement:'Source data summary (supplement)',jobInterrupted:'Task interrupted (for example by a service restart); incomplete, with no further automatic checks.',selectionSomeFailed:'Task ended, but some experts failed or did not finish. Only actual independent research is retained.',selectionQuantNotRequested:'Quant not requested (not a disqualification)',selectionQuantUnavailable:'Quant unavailable (not a disqualification)',selectionQuantAvailable:'Quant retrieved, for assistance only',selectionIntro:'Each expert independently discovers candidates, retrieves evidence and selects by their philosophy. Fundamentals and quant are optional tools, not preset candidates or fixed financial filters. Research is budget-limited, not a stock-by-stock whole-market scan.',selectionStyle:'AI-style experts, not the actual people',selectionBrief:'Research preferences (optional, not hard-coded filters)',selectionBriefHint:'Describe preferences freely, up to 1,000 characters. No stock code, target day or financial thresholds required.',selectionStart:'Start expert selection (model calls may cost money)',selectionParameters:'Frozen task parameters',selectionChanged:'The form has changed. Results below still belong to the original task, not a new request. No duplicate submission while it is active.',selectionNames:'Task experts',selectionLimit:'Maximum picks per expert',selectionNoBrief:'No preferences supplied',selectionMissingSector:'Choose a sector on the sector page before starting selection.',selectionBriefLong:'Preferences must not exceed 1,000 characters.',selectionPollPaused:'Automatic checks paused (10 minutes / 300 checks maximum). The task ID is retained; the backend was not stopped. Continue checks manually.',selectionPartial:'Partial research: the task is not finished and lists may change.',selectionOnlyResearch:'Independent research candidates, not buy instructions. Missing quant does not disqualify a stock; historical hit rates are not selection scores.',selectionApproach:'Independent research approach',selectionPicks:'Independent candidate list',selectionNoPicks:'This expert selected no candidates. No filler stocks.',selectionPending:'Waiting for independent expert results.',selectionFit:'Fit with expert philosophy',selectionMissing:'Missing evidence',selectionRejected:'Not selected and why',selectionCoverage:'Actual research coverage',selectionCommon:'Common interests',selectionDifferences:'List differences',selectionCompareNote:'Overlap and differences describe independent lists, not a unified vote, win rate or upside probability.',selectionNoCommon:'No common candidates yet.',selectionNoDifferences:'No list differences yet.',selectionActivity:'Expert research and data activity',selectionErrors:'Expert failures / incomplete research',selectionEvidenceMissing:'Matching evidence source not found; this is not verified evidence.',selectionEvidenceSummary:'Data summary',selectionUniverse:'Universe directory',selectionNone:'No expert lists returned. This is not a successful selection.',selectionCancelWait:'Cancellation is awaiting its HTTP response. In-flight model/data calls may not stop immediately. No orders are placed.',selectionExpertsUnavailable:'No enabled experts. Check expert configuration and retry.',selectionNoRisks:'No risk explanation supplied; this does not mean no risk.',stockLookup:'Stock/ETF name or code',lookupHint:'Find a stock or ETF by name, or enter a six-digit code, then choose Find stocks or Find ETF. No future target date required.',confidenceLow:'Low',confidenceMedium:'Medium',confidenceHigh:'High',decisionUp:'Bullish consensus',decisionDown:'Bearish consensus',decisionNone:'No consensus yet',evidenceCoverage:'Evidence available to the team',financials:'Financial statements',valuations:'Valuation ratios',newsEvidence:'News evidence',covered:'Retrieved',notAvailable:'Not retrieved',screen:'Expert selection',stock:'Stock/ETF analysis',sectors:'Sector analysis',experts:'Expert team',watchlist:'Watchlist',journal:'Research records',settings:'Data & settings',sectorAi:'AI sector analysis',sectorAiHelp:'This creates a separate session in the Ai板块分析 workspace. AI reads the real sector report and analyzes it there; raw market tables are not shown on this page.',sectorAiStart:'Start AI sector analysis',stockAiStart:'Start AI stock analysis',stockAiRunning:'Creating session',stockAiHelp:'Creates a separate session in Ai个股分析. AI reads the real stock report, uses every enabled expert, and shows each reason, evidence, scenario and risk.',stockAiOpen:'Open stock analysis session',sectorAiRunning:'Creating session',sectorAiOpen:'Open analysis session',sectorAiAccepted:'The analysis session was created and opened; AI is analyzing there.',sectorAiSessionReady:'The session exists; open it if it did not open automatically.',sectorAiExperts:'Choose experts',sectorAiNoExperts:'No enabled expert. Select experts on the Expert team page first.',sectorAiOther:'The current result belongs to another research target.',workflow:'Find opportunities, read the evidence, then explore conditional team outlooks.',disclaimer:'Research only. No orders or promised returns. In-sample hit rates are not calibrated future probabilities; majority votes are not upside probabilities.',trendStyle:'Trend alignment',watchStyle:'Bullish watch',scope:'Selection universe',market:'All A-shares',marketScope:'All A-shares by default; experts discover candidates independently.',watchScope:'My watchlist',sectorScope:'All constituents of the selected sector',cutoff:'Historical data as of',unknown:'Unknown',source:'Source',startScreen:'Start selection',screenHelp:'Choose real experts and optional preferences, then explicitly confirm model costs. No automatic model calls.',screenIdle:'Expert selection has not started. The default universe is all A-shares.',screenEmpty:'No candidates selected. No filler stocks.',pool:'Covered pool',matched:'Matches',reason:'Why selected',signals:'Multi-period signals',research:'Research stock',addWatch:'Add to watchlist',added:'Added to watchlist',code:'Stock code',codeHint:'Enter a six-digit A-share code directly; local history coverage is not required.',searchStock:'Find a stock by name',findStock:'Find stocks',findEtf:'Find ETF',findFund:'Find fund (ETF/LOF)',stockSearchEmpty:'No matching stocks.',brief:'View trend brief',briefHelp:'Look up a stock or listed fund to follow its price, or open an expert session to research its trend.',emptyBrief:'Enter a code for real evidence. Missing local quant coverage does not hide independent market data.',quote:'Quote snapshot',history:'Real daily candles & volume',structure:'Price / volume structure',quant:'5 / 10 / 20-period quant',agreement:'Signal alignment',bullish:'Bullish alignment',bearish:'Bearish alignment',mixed:'Periods disagree',neutral:'No directional signal',unavailable:'Unavailable',up:'Bullish',down:'Bearish',range:'Range',signalZero:'No direction · hit rate is null',hitRate:'Historical same-signal hit rate',samples:'Historical samples',coverage:'Coverage',period:'Period',cycle:'trading-day scale',notCovered:'No local quant coverage. A same-number stock is never substituted.',lastPrice:'Last price',change:'Change',quoteTime:'Quote API snapshot time',apiTime:'Candle API time',snapshotNote:'API time is not trade time. Quotes and historical signals may have different dates.',stale:'Historical signals predate quotes; they are not real-time signals.',ma5:'MA5',ma20:'MA20',ma60:'MA60',return5:'5-day change',return20:'20-day change',lowReference:'20-day low reference',support:'Valid-vote support',resistance:'20-day high reference',volumeRatio:'Volume ratio',forward:'Forward adjusted',unadjusted:'Index · unadjusted',chartEmpty:'No valid real candles. No illustrative or future candles are generated.',chartLegend:'Legend: ↑ close ≥ open; ↓ close < open; lower bars show volume. Acquired historical data only.',volume:'Volume',bars:'bars',teamNext:'Ask the expert team about trends',teamNextHelp:'Next, choose experts and confirm model costs before analysis.',draft:'Prepare Super Trader draft',draftHelp:'Draft only. Review and send yourself; no automatic model call.',draftReady:'Super Trader draft prepared. Not sent; no model called.',copyDraft:'Read-only evidence to copy',industry:'Industry',concept:'Concept',sectorSearch:'Search sector name',findSector:'Find sectors',chooseSector:'Select a sector to research its full qualified code.',noSectors:'No matching sectors.',constituents:'Constituents',breadth:'Constituent breadth',breadthSample:'Sample / total constituents',rising:'Up',falling:'Down',flat:'Flat',missing:'Missing',screenSector:'Screen this sector',previous:'Previous',next:'Next',teamIntro:'AI style experts, not the named people. The team combines market, price/volume and multi-period quant evidence for conditional trends and risks, not a guess for one date.',currentTarget:'Current research target',chooseTarget:'Select a stock or sector first, then bring it here.',selectExperts:'Choose experts',noExperts:'No real expert configuration is available.',cost:'The button below calls your configured models and may incur API charges. Submission happens only on your click and is never retried automatically.',startTeam:'Confirm costs & start team research',submitting:'Submitting research…',submitted:'Task submitted; analysis is not necessarily complete.',job:'Research task',progress:'Progress',cancel:'Cancel this research',cancelHelp:'Cancellation stops only this research, never a securities order.',continueCheck:'Continue checking',pollPaused:'Automatic checks paused (5 minutes / 150 checks). Continue checking does not resubmit.',jobOther:'The task below belongs to another target, not a new conclusion for your current selection.',resultTarget:'Report target',reportTime:'Evidence created at',teamView:'Team views & disagreement',voteNote:'Support measures agreement among valid votes, not a win rate or upside probability.',votesUp:'Bullish votes',votesDown:'Bearish votes',abstained:'Abstained',shortTerm:'Short-term outlook',mediumTerm:'Medium-term outlook',bullCase:'Bullish conditions',bearCase:'Bearish conditions',invalidation:'Invalidation',risks:'Key risks',evidence:'Evidence sources & references',noEvidence:'No verifiable evidence returned. No expert conclusion is invented.',errors:'Source issues',loading:'Fetching real evidence…',retry:'Retry',requestFailed:'Request did not complete',invalidCode:'Enter a valid six-digit stock code',invalidSector:'Select a full qualified sector code (881...TI)',invalidResponse:'Response is invalid or does not match the target',consentRequired:'Confirm model costs explicitly before starting',selectExpert:'Select at least one enabled expert',activeJob:'A research task exists. Review or cancel it first to avoid duplicate charges.',backChat:'Back to Super Trader chat',connected:'Backend ready',offline:'Backend unavailable',retryStart:'Retry connection',advanced:'Advanced historical research',advancedNote:'Legacy pages are for advanced historical research. Single-period settings are not the main trend workflow.',quantTab:'Historical quant',refresh:'Refresh',watchEmpty:'No watchlist stocks yet. Add one from selection or a stock brief.',watchHelp:'Choose a stock to open its full trend brief.',disabledExpert:'Disabled',jobRunning:'Analyzing',jobCompleted:'Completed',jobFailed:'Failed',jobCancelled:'Cancelled',jobQueued:'Queued',cancelPending:'Cancelling…',expertTraits:'Traits',expertNew:'New expert',expertDelete:'Delete',expertDeleteQuestion:'Delete expert',expertDeleteNote:'Saved analysis history is kept. Restoring requires creating it again.',expertDeleteConfirm:'Confirm delete',expertDeleting:'Deleting…',expertAiRequirement:'What expert would you like to create?',expertAiExample:'Example: an expert inspired by public trading methods of a Bilibili trader',expertAiHelp:'Create a separate conversation in 新建专家. AI must perform live search, read and cite sources before saving; unavailable or insufficient sources cannot be replaced by model memory.',expertAiCost:'Starting opens a Super Trader AI conversation and may incur model charges. Progress and questions appear there.',expertAiStart:'Start AI creation',expertAiAccepted:'AI accepted the request; the expert is not yet confirmed saved. Check the conversation, then refresh this list.',expertAiSessionReady:'The conversation exists, but submission is not confirmed. Retry the same request or open it.',expertAiOpen:'Open creation conversation',expertCreate:'Create expert',expertToolsHint:'Tools (one per line)',expertMethod:'Methodology (system prompt)',expertEdit:'Edit',expertSave:'Save',expertCancel:'Cancel',expertName:'Name',expertTag:'Traits',expertCriteria:'Analysis lens (one per line)',expertSystemPrompt:'Methodology (system prompt)',expertModel:'Model',expertTools:'Evidence tools',criteria:'Perspective',reportEvidence:'Market and quant evidence used by this team',confidence:'Model self-reported confidence (uncalibrated)',decision:'Consensus direction',allSignals:'Each period is independent. Missing or neutral signals never receive invented values.',screenSignals:'Bullish / bearish period counts',openStock:'Open stock analysis',openSector:'Open sector analysis',scopeMissing:'Select a sector in sector analysis first.',notStarted:'Not started',cancelled:'Research stopped',noRisk:'No specific risk returned; this does not mean risk-free.'}
  };
}
function investBatchMessages(lang) {
  const zh={factorLiveOutput:'实时输出',factorOutputWaiting:'等待模型输出',factorOutputNote:'只读模型输出，不是准确率证据或已验证结论。',factorOutputLatest:'回到最新',factorOutputThinking:'思考',factorOutputTool:'工具',factorOutputStatus:'状态',factorOutputSummary:'实时摘要（非完整输出）',factorOutputEnded:'输出已终止',factorOutputRetry:'重试读取输出',factorBacktestPick:'选择标的回测已选量化因子',factorQueryRule:'查询该量化因子回测',factorNoRuleSelected:'先在因子库选择一条已挖掘量化因子',factorBatch:'批量挖掘',factorContractError:'因子接口字段不匹配',factorAll:'全部本地日线目录（个股 / ETF / 指数）',factorBatchIntro:'一个 LLM 共同研究候选量化因子，后台固定数量进程分片评测全部本地标的；逐标的各自保留最佳。股票间量化因子可不同，同股同日线 h=1–20 只用一条量化因子。不做横截面排名。',factorBatchCapacity:'不抽样、不把前200条当全量；分片依次处理，不承诺几千标的同时驻留内存或瞬间完成。',factorDirectory:'本地日线目录',factorDirectoryEmpty:'目录尚未读取；不会把未知数量显示为全量。',factorWorkers:'评测进程数',factorBudget:'高级预算上限',factorBudgetHint:'“新尝试量化因子数”是评测次数；全量8,228每个候选约9分半，50次通常需要数小时。研究时间不设上限，任务会一直跑到完成或你取消。',factorTrials:'新尝试量化因子数',factorCalls:'模型调用上限',factorMinutes:'最长研究分钟',factorBrief:'研究线索（可选）',factorStart:'开始批量挖掘（调用模型可能计费）',factorCost:'仅明确点击开始才调用模型，可能产生费用；读取目录、查询成果不调用模型。',factorResearchInvalid:'批量参数无效：进程数须为2/4/8，预算须为正整数，线索不超过1000字。',factorBatchPhase:'当前候选评测阶段',factorFinalValidation:'自动全量验证（仅本地计算，不增加模型调用）',factorFinalValidationNote:'模型停止后会自动用本次最佳候选对全部标的补一次全量验证；不额外调用模型，约需数分钟。',factorPhaseProgress:'本候选已处理 / 目标',factorTrialProgress:'已完成试验 / 新尝试量化因子数',factorJobProgress:'作业调度进度（非研究质量完成率）',factorProcessed:'已处理评测',factorFailed:'失败',factorInsufficient:'不足数据 / 跳过',factorImproved:'最佳量化因子改善数',factorModelCalls:'已调用模型',factorRulesWritten:'已写入候选量化因子',factorTrialsDone:'已完成试验',factorPartial:'以下仅为阶段成果；已验证结果保留。预算耗尽或任务结束不表示全部标的均完成评测。',factorPollPaused:'自动检查已暂停（网络或接口错误）；任务仍在后端运行，可手动继续，不会重新提交。',factorResults:'逐标的评测与成果',factorResultsNote:'按类别 / 代码分页，不按准确率或涨幅跨股排名；未处理、失败或不足数据不冒充已验证成果，空值不补零。',factorNoResults:'暂无已验证成果；尚无LLM结果时不会用种子量化因子冒充。',factorResultQuery:'按代码检索',factorCategory:'标的类别',factorOpen:'查询该标的',factorSourceLLM:'LLM批量成果',factorSourceAdHoc:'临时代码回测（非LLM批量成果）',factorSourceSeed:'种子参考（非LLM批量成果）',factorSourceUnknown:'量化因子来源未提供',factorActivity:'最近研究步骤',factorErrors:'有界错误摘要',factorRestore:'读取最近批量任务',factorRestoreNote:'仅恢复后端最近10个作业中的 factor_research，不自动提交。',factorNoHistory:'最近10个作业没有批量挖掘任务。',factorPhaseUnknown:'等待阶段摘要',factorCandidates:'候选量化因子',factorCreated:'任务创建时间',factorTaskSubset:'本任务显式子集',factorTaskLocalTotal:'本地总',factorTaskAll:'本任务全量范围',factorTaskScopeNote:'此处为已提交任务范围；上方表单只新建全量任务，不会沿用子集。',factorResultStatus:'评测状态',factorPendingResult:'待挖掘（暂无已验证量化因子）',factorFailedResult:'本次评测失败',factorInsufficientResult:'不足数据 / 跳过',factorCompletedResult:'已完成本次评测',factorVerifiedResult:'已有已验证量化因子'};
  const en={factorLiveOutput:'Live output',factorOutputWaiting:'Waiting for model output',factorOutputNote:'Read-only model output, not accuracy evidence or verified conclusions.',factorOutputLatest:'Back to latest',factorOutputThinking:'Thinking',factorOutputTool:'Tool',factorOutputStatus:'Status',factorOutputSummary:'Live summary (not full output)',factorOutputEnded:'Output ended',factorOutputRetry:'Retry output read',factorBacktestPick:'Backtest the selected rule on a target',factorQueryRule:'Query this rule backtest',factorNoRuleSelected:'Select a mined rule in the factor library first',factorBatch:'Batch mining',factorContractError:'Factor API field mismatch',factorAll:'All local daily targets (stocks / ETFs / indices)',factorBatchIntro:'One LLM researches shared candidates. A fixed number of backend processes evaluate all local targets in shards, retaining each target’s best rule. One daily rule spans h=1–20 per target; rules may differ by target. No cross-sectional ranking.',factorBatchCapacity:'No sampling or first-200 proxy. Shards are processed progressively; no instant completion or all-target memory promise.',factorDirectory:'Local daily directory',factorDirectoryEmpty:'Directory not read; unknown counts are not presented as complete.',factorWorkers:'Evaluation processes',factorBudget:'Advanced budget limits',factorBudgetHint:'“New rules to try” counts evaluations; a full 8,228-target pass takes about 9.5 minutes, so 50 tries usually need hours. Research time is unlimited; the job runs until it finishes or you cancel.',factorTrials:'New rules to try',factorCalls:'Maximum model calls',factorMinutes:'Maximum minutes',factorBrief:'Optional research brief',factorStart:'Start batch mining (model calls may incur cost)',factorCost:'Only explicitly starting may call paid models. Directory and result reads do not call models.',factorResearchInvalid:'Invalid parameters: processes 2/4/8, positive integer budgets, brief up to 1000 characters.',factorBatchPhase:'Current candidate evaluation',factorFinalValidation:'Automatic full validation (local compute, no extra model calls)',factorFinalValidationNote:'After the model stops, the best candidate is evaluated on all targets; no extra model calls, takes a few minutes.',factorPhaseProgress:'This candidate: processed / targets',factorTrialProgress:'Completed trials / new rules to try',factorJobProgress:'Job scheduling progress (not quality completion)',factorProcessed:'Target evaluations',factorFailed:'Failed',factorInsufficient:'Insufficient / skipped',factorImproved:'Best-rule updates',factorModelCalls:'Model calls',factorRulesWritten:'Candidate rules written',factorTrialsDone:'Completed trials',factorPartial:'Partial verified results are retained. Budget exhaustion or job termination does not imply every target was evaluated.',factorPollPaused:'Automatic checks paused (network or API error). The job keeps running; continue manually without resubmitting.',factorResults:'Evaluation and results by target',factorResultsNote:'Paged by category / code, never cross-target accuracy or return rankings. Pending, failed and insufficient-data targets are not verified results. Nulls stay null.',factorNoResults:'No verified results yet; seed references never masquerade as LLM results.',factorResultQuery:'Filter by code',factorCategory:'Target category',factorOpen:'Query this target',factorSourceLLM:'LLM batch result',factorSourceAdHoc:'Ad-hoc code backtest (not LLM batch)',factorSourceSeed:'Seed reference (not LLM batch)',factorSourceUnknown:'Rule source not supplied',factorActivity:'Recent research steps',factorErrors:'Bounded error summary',factorRestore:'Read recent batch job',factorRestoreNote:'Read-only recovery from factor_research jobs among the latest 10; never auto-submit.',factorNoHistory:'No batch research job among the latest 10.',factorPhaseUnknown:'Awaiting phase summary',factorCandidates:'Candidate rules',factorCreated:'Job created',factorTaskSubset:'This job: explicit subset',factorTaskLocalTotal:'Local total',factorTaskAll:'This job: all local targets',factorTaskScopeNote:'This is the submitted job scope. The start form creates all-target jobs only; it never inherits a subset.',factorResultStatus:'Evaluation status',factorPendingResult:'Pending mining (no verified rule)',factorFailedResult:'Evaluation failed',factorInsufficientResult:'Insufficient data / skipped',factorCompletedResult:'Evaluation completed',factorVerifiedResult:'Verified rule available'};
  Object.assign(zh,{selectionWatchHint:'自选股范围会把自选的每一只（个股/ETF/LOF）都逐一深度分析并给结论，不是挑选名单。',watchAddEmptyStock:'没有匹配的股票。',watchAddEmptyFund:'没有匹配的基金（ETF/LOF）。',stockSearchEmptyFund:'没有匹配的基金（ETF/LOF）。',selectionAllExperts:'本次使用全部已启用的专家（与专家团队一致），无需在此勾选。',selectionSector:'选择板块',selectionOpenSession:'打开专家选股会话',watchAiStart:'专家团队分析选中的自选股',watchAiHelp:'会为每只选中标的调用全部启用专家并可能产生较多费用；只数越多耗时越长，串行执行。',watchAiOpen:'打开自选股分析会话',watchSelectAll:'全选',watchSelectNone:'取消全选',watchChoose:'选择',watchAddTitle:'添加自选股',watchAddLabel:'股票/ETF名称或代码',watchAddHint:'输入名称或 6 位代码，选择“查找股票”或“查找基金”（含 ETF/LOF），再从结果里加入自选。',watchAddEmpty:'没有匹配的股票或 ETF。',watchInList:'已在自选',watchAdded:'已加入自选',removeWatch:'移除'});
  Object.assign(en,{selectionWatchHint:'The watchlist scope evaluates every saved target one by one (stocks, ETFs, LOFs) instead of picking a list.',watchAddEmptyStock:'No matching stock.',watchAddEmptyFund:'No matching fund (ETF/LOF).',stockSearchEmptyFund:'No matching fund (ETF/LOF).',selectionAllExperts:'This run uses every enabled expert, the same set as the expert team.',selectionSector:'Sector',selectionOpenSession:'Open selection session',watchAiStart:'Analyze selected with the expert team',watchAiHelp:'Runs every enabled expert for each selected target and may cost more; up to 10 targets per run, executed sequentially.',watchAiOpen:'Open watchlist analysis session',watchSelectAll:'Select all',watchSelectNone:'Clear selection',watchChoose:'Select',watchAddTitle:'Add to watchlist',watchAddLabel:'Stock/ETF name or code',watchAddHint:'Enter a name or 6-digit code, choose Stock or ETF, then add it from the results.',watchAddEmpty:'No matching stock or ETF.',watchInList:'already watched',watchAdded:'Added to watchlist',removeWatch:'Remove'});
  Object.assign(zh,{reviews:'AI 专家复盘',reviewScopeSector:'板块',reviewCondition:'触发条件',reviewAtOrBelow:'≤',reviewAtOrAbove:'≥',reviewInvalidAt:'失效',reviewDelete:'删除这条复盘',reviewRule:'这个页面只做一件事：验证“选中之后到底有没有按专家说的条件买入、买入之后表现如何”，并据此统计专家与信心度的真实成绩；所有数字来自真实行情。',reviewLegend:'状态含义：已触发＝买入条件成立，收益从触发日算；未触发＝观察期内没到条件，视为没买，不计收益；参考＝专家没给触发条件，只能按入选价参考跟踪，不算已买入；已失效＝先跌破失效价；跟踪中＝还没有足够的后续交易日。窗口里的“—”表示还没走够对应交易日。',reviewReferenceCount:'无触发条件',reviewJudge:'AI 判定触发',reviewJudgeHelp:'让模型逐只阅读入选理由与触发条件，再对照入选后的真实行情判断是否真的触发；会调用模型并可能计费。',reviewJudgeDone:'已判定',reviewJudgeSkipped:'跳过',reviewHelp:'把每次选股的名单冻结下来，按真实行情跟踪是否触发买入条件、触发后的表现；未触发的不计收益。复杂条件会在每个交易日收盘后自动判定一次，不必手动点。',reviewSyncPending:'{n} 个已完成选股尚未归档',reviewSync:'归档已完成选股',reviewOpen:'查看',reviewEmpty:'还没有可复盘的选股记录。先完成一次选股，或点“归档已完成选股”。',reviewDetail:'复盘详情',reviewTime:'归档时间',reviewScope:'范围',reviewTargets:'候选数',reviewName:'名称',reviewExperts:'推荐专家',reviewConfidence:'信心度',reviewStatus:'状态',reviewBaseDate:'触发/起算日',reviewBasePrice:'起算价',reviewNow:'当前',reviewDrawdown:'最大回撤',reviewEntered:'已入场 / 候选',reviewBench5:'候选等权5日',reviewBench20:'候选等权20日',reviewByExpert:'按专家',reviewByConfidence:'按信心度',reviewExpert:'专家',reviewPicks:'入选',reviewTriggeredCount:'已触发',reviewNotTriggeredCount:'未触发',reviewTriggerRate:'触发率',reviewWinRate:'胜率',reviewRank:'名次',reviewNotRanked:'样本不足',reviewTriggered:'已触发',reviewReference:'参考(未给条件)',reviewNotTriggered:'未触发(未入场)',reviewInvalidated:'已失效',reviewPending:'跟踪中',reviewUnavailable:'不可计算'});
  Object.assign(en,{reviews:'AI selection review',reviewScopeSector:'Sector',reviewCondition:'Trigger',reviewAtOrBelow:'≤',reviewAtOrAbove:'≥',reviewInvalidAt:'Invalid at',reviewDelete:'Delete this review',reviewRule:'This page verifies whether each pick actually met its entry condition and how it performed afterwards. Every number comes from real prices.',reviewLegend:'Status: triggered = the entry condition was met and returns start at that bar; not triggered = the condition never hit, treated as no position; reference = the expert gave no condition, tracked from the pick price only; invalidated = the stop level broke first; pending = not enough sessions yet. A dash in a window means that many sessions have not elapsed.',reviewReferenceCount:'No condition',reviewJudge:'Let AI judge triggers',reviewJudgeHelp:'The model reads each pick condition against real post-selection bars to decide whether it actually triggered. Calls the model and may cost.',reviewJudgeDone:'Judged',reviewJudgeSkipped:'Skipped',reviewHelp:'Freezes every pick and tracks real prices: whether the entry condition triggered and what happened after. Untriggered picks earn no return. Complex conditions are assessed once after each trading close without a click.',reviewSyncPending:'{n} finished selections are not archived yet',reviewSync:'Archive finished selections',reviewOpen:'Open',reviewEmpty:'No reviewable selections yet.',reviewDetail:'Review detail',reviewTime:'Archived',reviewScope:'Scope',reviewTargets:'Picks',reviewName:'Name',reviewExperts:'Experts',reviewConfidence:'Confidence',reviewStatus:'Status',reviewBaseDate:'Trigger/base date',reviewBasePrice:'Base price',reviewNow:'Now',reviewDrawdown:'Max drawdown',reviewEntered:'Entered / picks',reviewBench5:'Equal-weight 5d',reviewBench20:'Equal-weight 20d',reviewByExpert:'By expert',reviewByConfidence:'By confidence',reviewExpert:'Expert',reviewPicks:'Picks',reviewTriggeredCount:'Triggered',reviewNotTriggeredCount:'Not triggered',reviewTriggerRate:'Trigger rate',reviewWinRate:'Win rate',reviewRank:'Rank',reviewNotRanked:'sample too small',reviewTriggered:'Triggered',reviewReference:'Reference (no condition)',reviewNotTriggered:'Not entered',reviewInvalidated:'Invalidated',reviewPending:'Tracking',reviewUnavailable:'Unavailable'});
  Object.assign(zh,{integrationTitle:'首次使用：先连接同花顺',integrationBody:'Super Trader 的行情、选股、复盘都依赖同花顺 MCP；未连接时页面能打开，但取不到真实数据。',integrationStep1:'点击左侧边栏的「MCP连接器」按钮（本机没有设置页入口，入口在侧栏）。',integrationStep2:'新增两个自定义连接：传输 streamable-http、鉴权 API Key（X-Api-Key），地址分别为 a-share 与 meta 两条。',integrationStep3:'保存后回到本页点「重新检测」；显示已连接即可使用。',integrationCopied:'地址已复制',integrationRecheck:'重新检测'});
  Object.assign(en,{integrationTitle:'First run: connect Hithink (THS) first',integrationBody:'Quotes, screening and review all rely on the Hithink MCP servers. Without them the page opens but shows no real data.',integrationStep1:'Click the MCP Connector button in the left sidebar (this build has no settings entry).',integrationStep2:'Add two custom connections: transport streamable-http, auth API Key (X-Api-Key), using the a-share and meta URLs below.',integrationStep3:'Save, then press Recheck here; connected means you are ready.',integrationCopied:'URL copied',integrationRecheck:'Recheck'});
  Object.assign(zh,{
    reviewRefresh:'刷新复盘',reviewHistory:'历史批次',reviewLatest:'最新批次',reviewHistoryBatch:'历史批次',reviewRecordId:'复盘编号',reviewSource:'判定来源',reviewNext:'下一步',reviewAnswers:'本批结论',reviewPlans:'专家计划',reviewPlanUnit:'项',reviewStockUnit:'只',reviewStockPlans:'逐股查看独立计划',reviewStats:'专家与信心度统计',reviewNotes:'口径与数据说明',
    reviewScopeMarket:'全 A 股',reviewScopeWatch:'自选股',reviewBatchSource:'已归档的选股计划；行情随刷新更新。',reviewLegacyBatch:'旧版归档只保留了合并后的股票记录，不能归因到各专家，也不纳入独立计划统计。',reviewLegacyPlan:'旧版合并记录',reviewLegacy:'历史合并记录',reviewMultiple:'按专家计划分别判定',reviewNeedsAi:'待判定（复杂条件）',reviewAmbiguous:'待补证（不计模拟入场）',reviewSummaryAmbiguous:'{n} 项待补证（不计模拟入场）',reviewPending:'仍需等待',reviewReference:'仅参考（无触发条件）',reviewUnavailable:'缺少可用行情',reviewNotTriggered:'观察期结束，未入场',reviewTriggered:'已触发',reviewInvalidated:'先失效，未入场',
    reviewSummaryWaiting:'{n} 项还在等触发',reviewSummaryTriggered:'{n} 项已触发',reviewSummaryResolved:'{n} 项已满 20 个交易日，可回看完整窗口',reviewSummaryClosed:'{n} 项未入场，观察已结束',reviewSummaryComplex:'{n} 项复杂条件等待 AI 判定',reviewSummaryReference:'{n} 项仅作参考',reviewSummaryUnavailable:'{n} 项暂缺行情',reviewNoneTriggered:'暂未确认有计划触发',reviewSummaryLegacy:'仅保留旧版跟踪数据，无法还原独立计划结论。',reviewSummaryEmpty:'没有可评估的独立计划。',reviewSentenceEnd:'。',reviewSentenceJoin:'；',
    reviewNextPending:'等待后续交易日，再刷新复盘',reviewNextTriggered:'按已触发后的交易日观察表现，未满的窗口继续等',reviewNextComplete:'查看已完成的观察结果，无需再判定入场',reviewNextClosed:'该计划不计入场收益，无需继续等触发',reviewNextReference:'只看参考走势，不计入场表现',reviewNextComplex:'展开对应股票，可手动发起 AI 判定',reviewNextAmbiguous:'暂不算入场；查看证据后再核对',reviewNextUnavailable:'行情可用后手动刷新复盘',reviewNextLegacy:'仅供回看；无法重建独立计划',reviewNextMultiple:'展开股票，分别核对各专家的状态和下一步',reviewUnknownSource:'当前没有可核实的判定来源',
    reviewSourceRule:'日线收盘价规则',reviewSourceAi:'手动发起的 AI 判定（基于真实行情）',reviewSourceArchive:'冻结的选股计划',reviewSourceLegacy:'旧版归档',reviewSourceReference:'入选价参考，不是入场',reviewSelectionEntry:'入选参考日 / 价',reviewAsOf:'行情截至',reviewWaited:'已等待交易日',reviewAfterEntry:'触发后交易日',reviewAwaitingWindows:'未到期窗口',reviewWindows:'触发后收益',reviewRefWindows:'参考价走势',reviewAiEvidence:'AI 判定依据',reviewPlanMissing:'未保存可展开的计划。',reviewNoCondition:'未给可执行条件',reviewNoWindows:'暂无可计入的入场收益。',reviewMissingEvidence:'本记录未保存额外证据。',reviewArchiveDetails:'归档信息',
    reviewJudgeBatch:'批量重新判定（可能计费）',reviewJudgeBatchConfirm:'将重新判定本批 {n} 条复杂条件，会调用模型并可能产生费用。继续？',reviewJudgeBatchRunning:'正在批量判定…',reviewJudgeBatchResult:'已重新判定 {judged} 项，跳过 {skipped} 项，失败 {errors} 项。',reviewJudgeBatchEmpty:'本批没有需要 AI 判定的复杂条件。',reviewJudge:'立即 AI 判定（可能计费）',reviewJudgeHelp:'仅用于复杂条件。每天收盘后（15:05 以后）会自动判定一次；也可以现在立即判定，会调用模型并可能计费。',reviewJudgeRunning:'正在核对该计划…',reviewJudgeUnavailable:'模型已经给出判定，请查看依据。',reviewJudgeResult:'已返回判定 {judged} 项，跳过 {skipped} 项，失败 {errors} 项。',reviewComparison:'历史复盘对照',reviewOpenSource:'打开来源复盘',reviewPerformance:'触发后表现',reviewDays:'{n} 日',reviewFailedPlan:'本计划判定失败',reviewSelectedAt:'选股完成时间',reviewInvalidationObserved:'失效日 / 当日收盘价',reviewTriggerObserved:'触发日 / 当日收盘价',reviewNotFill:'观察价，不代表实际成交。',reviewAiThrough:'AI 所用行情截至',reviewSummaryOutcome:'20 日结果：上涨 {up} 项、下跌 {down} 项、持平 {flat} 项',reviewNextNone:'没有可跟踪的计划，可在下次选股归档后刷新',reviewBaseline:'基准包含参考走势，不是组合收益。',
  });
  Object.assign(en,{
    reviewRefresh:'Refresh review',reviewHistory:'Batch history',reviewLatest:'Latest batch',reviewHistoryBatch:'Past batch',reviewRecordId:'Review ID',reviewSource:'Assessment source',reviewNext:'Next step',reviewAnswers:'Batch assessment',reviewPlans:'Expert plans',reviewPlanUnit:'plans',reviewStockUnit:'stocks',reviewStockPlans:'Independent plans by stock',reviewStats:'Expert and confidence statistics',reviewNotes:'Method and data notes',
    reviewScopeMarket:'All A-shares',reviewScopeWatch:'Watchlist',reviewBatchSource:'Archived selection plans; prices update on refresh.',reviewLegacyBatch:'Older archives merged picks by stock. They cannot be attributed to individual experts and are excluded from independent-plan statistics.',reviewLegacyPlan:'Legacy merged record',reviewLegacy:'Legacy merged record',reviewMultiple:'Assessed separately by plan',reviewNeedsAi:'Manual assessment needed (complex condition)',reviewAmbiguous:'More evidence needed (not a simulated entry)',reviewSummaryAmbiguous:'{n} need more evidence (not simulated entries)',reviewPending:'Still waiting',reviewReference:'Reference only (no trigger)',reviewUnavailable:'Price history unavailable',reviewNotTriggered:'Window closed without entry',reviewTriggered:'Triggered',reviewInvalidated:'Invalidated before entry',
    reviewSummaryWaiting:'{n} still waiting for their triggers',reviewSummaryTriggered:'{n} triggered',reviewSummaryResolved:'{n} have a complete 20-session return window',reviewSummaryClosed:'{n} finished without entering',reviewSummaryComplex:'{n} complex conditions awaiting AI assessment',reviewSummaryReference:'{n} are references only',reviewSummaryUnavailable:'{n} lack price history',reviewNoneTriggered:'No trigger has been confirmed yet',reviewSummaryLegacy:'Only legacy tracking data was saved; no independent assessments can be recovered.',reviewSummaryEmpty:'No independent plans to assess.',reviewSentenceEnd:'.',reviewSentenceJoin:'; ',
    reviewNextPending:'Wait for more trading sessions, then refresh',reviewNextTriggered:'Track returns from the trigger date and wait for incomplete windows',reviewNextComplete:'Review the completed windows; no entry judgment needed',reviewNextClosed:'No entry return applies and no trigger remains to wait for',reviewNextReference:'Reference movement only; do not count it as an entry',reviewNextComplex:'Expand the stock to run an optional manual AI assessment',reviewNextAmbiguous:'Do not count an entry; check the evidence',reviewNextUnavailable:'Refresh when price history is available',reviewNextLegacy:'For reference only; individual plans cannot be reconstructed',reviewNextMultiple:'Expand the stock to check each expert’s status and next step',reviewUnknownSource:'No verifiable assessment source is available',
    reviewSourceRule:'Daily close price rule',reviewSourceAi:'Manually started AI assessment (from observed prices)',reviewSourceArchive:'Frozen selection plan',reviewSourceLegacy:'Legacy archive',reviewSourceReference:'Selection price reference, not an entry',reviewSelectionEntry:'Selection reference date / price',reviewAsOf:'Prices through',reviewWaited:'Trading sessions waited',reviewAfterEntry:'Trading sessions since trigger',reviewAwaitingWindows:'Incomplete windows',reviewWindows:'Returns after trigger',reviewRefWindows:'Movement from reference price',reviewAiEvidence:'AI assessment basis',reviewPlanMissing:'No plan details were saved.',reviewNoCondition:'No actionable trigger supplied',reviewNoWindows:'No entry return is available.',reviewMissingEvidence:'No additional evidence was saved.',reviewArchiveDetails:'Archive information',
    reviewJudgeBatch:'Re-assess the batch (may incur fees)',reviewJudgeBatchConfirm:'Re-assess {n} complex plans in this batch. The model is called and may cost money. Continue?',reviewJudgeBatchRunning:'Assessing the batch…',reviewJudgeBatchResult:'Re-assessed {judged}, skipped {skipped}, failed {errors}.',reviewJudgeBatchEmpty:'This batch has no complex plans to assess.',reviewJudge:'Run AI assessment now (may incur fees)',reviewJudgeHelp:'Complex conditions only. It runs automatically once after each close (from 15:05 Shanghai); this button checks immediately and may cost.',reviewJudgeRunning:'Assessing this plan…',reviewJudgeUnavailable:'The model already assessed this plan. See the evidence.',reviewJudgeResult:'{judged} assessed, {skipped} skipped, {errors} failed.',reviewComparison:'Prior review comparison',reviewOpenSource:'Open source review',reviewPerformance:'Post-trigger performance',reviewDays:'{n}d',reviewFailedPlan:'Plan assessment failed',reviewSelectedAt:'Selection finished',reviewInvalidationObserved:'Invalidation date / observed close',reviewTriggerObserved:'Trigger date / observed close',reviewNotFill:'Observed price, not a trade fill.',reviewAiThrough:'Prices used by the model through',reviewSummaryOutcome:'20-session results: {up} up, {down} down, {flat} unchanged',reviewNextNone:'No plans to track; refresh after another selection is archived',reviewBaseline:'The benchmark includes reference moves and is not a portfolio return.',
  });
  const daily=lang==='zh'?{
    dailyRun:'立即进行 AI 复盘',dailyStarting:'正在启动复盘…',dailyIntro:'复盘最近一个已有收盘数据的交易日。已有会话会直接打开，不重复执行。',dailyHistory:'历史复盘日期',dailyChoose:'选择日期，直接打开会话',dailyEmpty:'还没有复盘会话。',dailySessionMissing:'当前无法打开会话。',dailyReturn:'返回复盘日期',
  }:{dailyRun:'Run AI review now',dailyStarting:'Starting review…',dailyIntro:'Review the latest session with closing data. Reopen its existing conversation instead of running twice.',dailyHistory:'Past review dates',dailyChoose:'Choose a date to open its conversation',dailyEmpty:'No review conversations yet.',dailySessionMissing:'Conversation navigation is unavailable.',dailyReturn:'Back to review dates'};
  return {...(lang==='zh'?zh:en),...investPortfolioMessages(lang),...daily};
}
function investPortfolioMessages(lang) {
  return lang==='zh'?{
    portfolioTitle:'专家模拟组合',portfolioCny:'元',portfolioReselection:'同一专家再次选中',portfolioReselectionCount:'累计入选次数',portfolioReselectionPrevious:'上次选中时间',portfolioReselectionReason:'再次选中原因',portfolioIntro:'每位专家独立管理模拟账户；净值按市场实际交易日期对比，不代表真实交易或未来收益。',portfolioStart:'模拟起始日',portfolioInitial:'每位专家初始资金',portfolioMaxPositions:'最多持仓',portfolioWeight:'目标单股仓位',portfolioRefresh:'刷新模拟组合',
    portfolioReturns:'累计收益率',portfolioNav:'组合净值（元）',portfolioMode:'图表指标',portfolioShowSeries:'显示曲线',portfolioBenchmark:'沪深300',portfolioBenchmarkMissing:'暂无可用沪深300基准',portfolioBenchmarkOnly:'沪深300仅在收益率视图中显示',portfolioChartNote:'横轴为日历日期；只绘制有数据的点，缺失值不补零。',portfolioDate:'日期',portfolioLatest:'最新图表值',portfolioChartEmpty:'暂无可绘制的模拟净值或收益数据。',portfolioChartHidden:'当前没有可绘制的可见曲线。可在上方启用其他曲线。',
    portfolioEmpty:'暂无模拟组合。完成一批新的专家选股后，再回来查看模拟组合。',portfolioGoSelect:'去发起新一批选股',portfolioExpert:'查看专家组合',portfolioTotalReturn:'累计收益率',portfolioDrawdown:'最大回撤',portfolioRealized:'已实现盈亏',portfolioUnrealized:'持仓浮动盈亏',portfolioCash:'可用现金',portfolioWinRate:'平仓胜率（盈利 / 已平仓）',portfolioAsOf:'净值估值截至',portfolioOrderWait:'等待原因',portfolioNoCosts:'模拟不计手续费和公司行动。开盘价仅用于模拟成交，不保证真实市场可执行。',
    portfolioOpen:'当前持仓',portfolioQueued:'待执行订单',portfolioClosed:'已平仓',portfolioContributions:'逐股盈亏贡献',portfolioStock:'证券',portfolioEntry:'模拟买入日 / 价',portfolioExit:'模拟卖出日 / 价',portfolioQuantity:'股数',portfolioClose:'估值收盘价',portfolioStop:'止损价',portfolioPnl:'盈亏贡献（元）',portfolioTradeReturn:'个股收益率',portfolioDirection:'方向',portfolioBuy:'买入',portfolioSell:'卖出',portfolioDecision:'决策日',portfolioReason:'原因',portfolioNoOpen:'没有当前持仓。',portfolioNoQueued:'没有待执行订单。',portfolioNoClosed:'没有已平仓记录。',portfolioNoContributions:'暂无可归属的持仓或平仓盈亏。',portfolioContributionNote:'按证券汇总本专家的持仓浮盈与平仓盈亏。待执行订单不计盈亏，缺少估值的项目留空。',
    reviewSignalTitle:'选股批次复盘 · 信号跟踪',reviewSignalNote:'以下检验选股信号的触发与后续走势，不是上方模拟组合的持仓、盈亏或胜率。',
  }:{
    portfolioTitle:'Simulated expert portfolios',portfolioCny:'CNY',portfolioReselection:'Selected again by this expert',portfolioReselectionCount:'Times selected',portfolioReselectionPrevious:'Previously selected at',portfolioReselectionReason:'Why it was selected again',portfolioIntro:'Each expert manages a separate simulated account. Values follow actual market dates; they are not live trades or a promise of returns.',portfolioStart:'Simulation start',portfolioInitial:'Initial cash per expert',portfolioMaxPositions:'Position limit',portfolioWeight:'Target weight per stock',portfolioRefresh:'Refresh portfolios',
    portfolioReturns:'Cumulative return',portfolioNav:'Portfolio NAV (CNY)',portfolioMode:'Chart metric',portfolioShowSeries:'Visible series',portfolioBenchmark:'CSI 300',portfolioBenchmarkMissing:'CSI 300 benchmark is unavailable',portfolioBenchmarkOnly:'CSI 300 is shown only in the return view',portfolioChartNote:'The x-axis follows calendar dates. Only observed values are plotted; missing values are not set to zero.',portfolioDate:'Date',portfolioLatest:'Latest chart values',portfolioChartEmpty:'There are no simulated NAV or return observations to plot.',portfolioChartHidden:'No visible series can be plotted. Enable another series above.',
    portfolioEmpty:'No simulated portfolios yet. Complete a new expert selection batch, then return here to view the portfolios.',portfolioGoSelect:'Start a new selection batch',portfolioExpert:'Inspect an expert portfolio',portfolioTotalReturn:'Total return',portfolioDrawdown:'Maximum drawdown',portfolioRealized:'Realized P&L',portfolioUnrealized:'Open P&L',portfolioCash:'Cash available',portfolioWinRate:'Closed win rate (wins / closes)',portfolioAsOf:'NAV valuation through',portfolioOrderWait:'Why still queued',portfolioNoCosts:'Simulation excludes fees and corporate actions. Opening prices are used for simulated fills; real execution is not assured.',
    portfolioOpen:'Open holdings',portfolioQueued:'Queued orders',portfolioClosed:'Closed trades',portfolioContributions:'P&L contribution by stock',portfolioStock:'Security',portfolioEntry:'Simulated entry date / price',portfolioExit:'Simulated exit date / price',portfolioQuantity:'Shares',portfolioClose:'Valuation close',portfolioStop:'Stop price',portfolioPnl:'P&L contribution (CNY)',portfolioTradeReturn:'Stock return',portfolioDirection:'Side',portfolioBuy:'Buy',portfolioSell:'Sell',portfolioDecision:'Decision date',portfolioReason:'Reason',portfolioNoOpen:'No open holdings.',portfolioNoQueued:'No queued orders.',portfolioNoClosed:'No closed trades.',portfolioNoContributions:'No open or closed P&L to attribute.',portfolioContributionNote:'Aggregates this expert’s open and realized P&L by security. Queued orders do not contribute, and figures with missing valuations are left blank.',
    reviewSignalTitle:'Selection batch review · Signal tracking',reviewSignalNote:'The entry triggers and subsequent price moves below are separate from simulated portfolio holdings, P&L and win rates.',
  };
}
function investText(value,limit) { return cockpitSafeText(typeof value==='string' ? value : value == null ? '' : typeof value==='object' ? JSON.stringify(value) : String(value),limit || 1800); }
function investIdle() { return {phase:'idle',data:null,error:null}; }
function investFactorOutputGroups(items) {
  const groups=[];for(const item of items){const last=groups[groups.length-1];if(last&&['thinking','content'].includes(item.kind)&&last.kind===item.kind)last.text+=item.text;else groups.push({...item});}return groups;
}
function investFactorAction(action) {return ({model_request:'请求模型',tool_error:'工具错误',tool_call:'调用工具',tool_result:'工具结果',shard_saved:'分片保存',started:'开始',start:'开始',rule_written:'量化因子写入',trial_started:'试验开始',trial_start:'试验开始',trial_completed:'试验完成',trial_complete:'试验完成',note_saved:'保存笔记',notes_saved:'保存笔记',stopped:'结束',completed:'完成',budget_exhausted:'预算停止',budget_stop:'预算停止'})[action]||investText(action);}
function investOutputTime(value) {const date=new Date(value);return typeof value==='string'&&Number.isFinite(date.getTime())?date.toLocaleString(undefined,{timeZone:'Asia/Shanghai',hour12:false}):investText(value)||'—';}
function investTargetKey(target) { return target ? target.kind+'|'+target.code : ''; }
function investFieldLabel(key) {
  const labels = investFieldLabel.labels || (investFieldLabel.labels = {
    parent_holder_net_profit:'归母净利润', net_profit:'净利润', total_operating_income:'营业总收入', operating_income:'营业收入',
    operating_cost:'营业成本', act_cash_flow_net:'经营活动现金流量净额', total_assets:'资产总计', total_liability:'负债合计',
    owner_total_equity:'所有者权益合计', pe_ttm:'滚动市盈率(TTM)', pb_mrq:'市净率(最新)', ps_ttm:'市销率(TTM)', pcf_ttm:'市现率(TTM)',
    last_price:'最新价', prev_price:'昨收', price_change_ratio_pct:'涨跌幅%', turnover_ratio_pct:'换手率%', volume:'成交量',
    turnover:'成交额', close_price:'收盘价', open_price:'开盘价', high_price:'最高价', low_price:'最低价', ma5:'5日均线',
    ma20:'20日均线', ma60:'60日均线', support_20d:'20日支撑', resistance_20d:'20日压力', volume_ratio:'量比',
    hold_ratio:'持仓占比', position_capital:'持仓市值', unit_nav:'单位净值', adj_nav:'复权净值', nav_date:'净值日期',
    fund_scale:'基金规模', rate_info:'费率', manager_name:'基金经理', stock_name:'证券名称', asset_type:'资产类型',
    security_market_value_rate_pct:'占净值比例%', end_date_ms:'报告期末', publish_date_ms:'披露日期', date_ms:'日期',
    timestamp:'数据时间', accuracy:'准确率', coverage:'覆盖率', direction:'方向'});
  return labels[key] || investText(key);
}


function investTarget(kind,code,name,category) {
  code=String(code || '').trim();
  if(kind==='sector' ? !/^\d{6}\.(?:TI|SH|SZ)$/i.test(code) : !/^\d{6}$/.test(code)) throw cockpitError(kind==='sector'?'invalidSector':'invalidCode');
  return {kind:kind==='sector'?'sector':'stock',code:kind==='sector'?code.toUpperCase():code,name:name || '',category:kind==='sector'?'板块':(category || '个股')};
}
function investReport(raw,target) {
  if(!raw || raw.kind!==target.kind || !raw.target || (target.kind==='sector' ? (raw.target.thscode || raw.target.code).toUpperCase()!==target.code : raw.target.code!==target.code)) throw cockpitError('invalidResponse');
  const result={...raw,quant:{...(raw.quant || {}),items:[]}};
  for(const horizon of [5,10,20]) {
    const item=(raw.quant?.items || []).find(row=>row.horizon===horizon);
    if(!item?.available) {result.quant.items.push({horizon,available:false,error:item?.error || 'unavailable'});continue;}
    const q=item.result;
    const valid=q && q.target?.horizon===horizon && (target.kind==='sector' ? raw.quant?.identity?.kind==='sector' && raw.quant.identity.thscode===target.code && q.symbol?.category==='指数' && [target.code,target.code.slice(0,6)].includes(q.symbol?.code) : q.symbol?.code===target.code && ['个股','A股','A股个股','stock','a-share','ETF','etf'].includes(q.symbol?.category)) && [-1,0,1].includes(q.direction) && (q.direction===0 ? q.probability===null : cockpitNumber(q.probability)!==null && q.probability>=0 && q.probability<=1);
    result.quant.items.push(valid ? item : {horizon,available:false,error:'invalidResponse'});
  }
  const dirs=result.quant.items.filter(i=>i.available).map(i=>i.result.direction);
  result.quant.available=dirs.length>0;
  result.quant.agreement=!dirs.length?'unavailable':dirs.includes(1)&&dirs.includes(-1)?'mixed':dirs.length<3?'mixed':dirs.every(d=>d===1)?'bullish':dirs.every(d=>d===-1)?'bearish':dirs.every(d=>d===0)?'neutral':'mixed';
  if(raw.history?.available) {try {const data=raw.history.data;const identity=target.kind==='sector' ? (data?.thscode || data?.code)===target.code : data?.code===target.code;if(!identity)throw cockpitError('invalidResponse');investHistory(data,target.kind,raw.target?.category);}catch {result.history={available:false,error:'invalidResponse'};}}
  if(raw.quote?.available && (!Array.isArray(raw.quote.data?.items) || !raw.quote.data.items.some(row=>target.kind==='sector' ? (row.thscode || row.code)===target.code : row.code===target.code))) result.quote={available:false,error:'invalidResponse'};
  return result;
}
function investHistory(data,kind,category) {
  const adjustOk=kind==='sector' ? data.adjust===null : ['ETF','LOF'].includes(category) ? (data.adjust==='forward'||data.adjust===null) : data.adjust==='forward';
  if(!data || data.interval!=='1d' || !adjustOk) throw cockpitError('invalidResponse');
  return cockpitHistoryModel({...data,adjust:'forward'});
}
function investFactorCheck(valid,path,expected,value) {
  if(!valid)throw cockpitError('factorContractError',path+'：预期'+expected+'；实际 '+(value===undefined?'缺失':investText(value,160))+'。这是接口数据契约错误，不表示股票代码无效。');
}
function investFactorRatio(value) {return value===null||typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;}
function investFactorCount(value) {return Number.isSafeInteger(value)&&value>=0;}
function investFactorUniverse(raw) {
  const check=investFactorCheck;
  check(investFactorCount(raw?.total),'universe.total','非负整数',raw?.total);
  check(raw.timeframe==='1d','universe.timeframe','1d',raw.timeframe);
  check(Array.isArray(raw.categories),'universe.categories','分类数量数组',raw.categories);
  for(const [i,row] of raw.categories.entries()){check(!!row&&typeof row==='object','universe.categories['+i+']','分类数量对象',row);check(['个股','ETF','指数'].includes(row.category),'universe.categories['+i+'].category','个股/ETF/指数',row.category);check(investFactorCount(row.count),'universe.categories['+i+'].count','非负整数',row.count);}
  check(new Set(raw.categories.map(row=>row.category)).size===raw.categories.length,'universe.categories','分类不重复',raw.categories);
  check(raw.categories.reduce((sum,row)=>sum+row.count,0)===raw.total,'universe.total','等于各分类数量之和',raw.total);
  return raw;
}
function investFactorReport(raw,target,ruleId) {
  const ratio=investFactorRatio,count=investFactorCount,check=investFactorCheck;
  const rule=(row,path)=>{check(typeof row?.id==='string'&&row.id.length>0,path+'.id','非空量化因子ID',row?.id);check(typeof row.name==='string',path+'.name','量化因子名称',row.name);};
  check(raw?.kind==='factor','kind','factor',raw?.kind);
  for(const key of ['code','timeframe','category'])check(raw.target?.[key]===target[key]&&target[key]!==undefined,'target.'+key,String(target[key]),raw.target?.[key]);
  check([-1,0,1].includes(raw.direction),'direction','-1/0/1',raw.direction);
  check(count(raw.bars),'bars','非负整数',raw.bars);check(typeof raw.as_of==='string','as_of','数据日期',raw.as_of);rule(raw.rule,'rule');
  if(ruleId)check(raw.rule.id===ruleId,'rule.id',ruleId,raw.rule.id);
  const m=raw.metrics;check(!!m,'metrics','回测指标对象',m);
  for(const key of ['accuracy','coverage'])check(ratio(m[key]),'metrics.'+key,'0–1数值或null',m[key]);
  for(const key of ['evaluated','correct','skipped','not_evaluated'])check(count(m[key]),'metrics.'+key,'非负整数',m[key]);
  check(m.correct<=m.evaluated,'metrics.correct','不大于evaluated',m.correct);
  for(const key of ['always_up','same_set'])check(ratio(m.baseline?.[key]),'metrics.baseline.'+key,'0–1数值或null',m.baseline?.[key]);
  check(Array.isArray(m.per_horizon)&&m.per_horizon.length===20,'metrics.per_horizon','20个h=1–20窗口',m.per_horizon);
  check(new Set(m.per_horizon.map(row=>row?.h)).size===20,'metrics.per_horizon.h','20个不重复窗口',m.per_horizon.map(row=>row?.h));
  m.per_horizon.forEach((row,i)=>{const path='metrics.per_horizon['+i+']';check(!!row&&typeof row==='object',path,'窗口对象',row);check(Number.isInteger(row.h)&&row.h>=1&&row.h<=20,path+'.h','整数1–20',row.h);check(ratio(row.accuracy),path+'.accuracy','0–1数值或null',row.accuracy);check(count(row.evaluated),path+'.evaluated','非负整数',row.evaluated);});
  for(const direction of ['up','down'])for(const actual of ['up','down','flat'])check(count(m.confusion?.[direction]?.[actual]),'metrics.confusion.'+direction+'.'+actual,'非负整数',m.confusion?.[direction]?.[actual]);
  check(Array.isArray(raw.rules),'rules','量化因子数组',raw.rules);
  raw.rules.forEach((row,i)=>{rule(row,'rules['+i+']');for(const key of ['accuracy','coverage'])check(ratio(row[key]),'rules['+i+'].'+key,'0–1数值或null',row[key]);});
  if(raw.samples)for(const key of ['false_positive','false_negative']){const rows=raw.samples[key];check(Array.isArray(rows)&&rows.length<=5,'samples.'+key,'最多5条样本',rows);rows.forEach((row,i)=>check(typeof row?.date==='string'&&Number.isInteger(row.h)&&row.h>=1&&row.h<=20&&typeof row.ret==='number'&&Number.isFinite(row.ret),'samples.'+key+'['+i+']','日期、h=1–20及数值ret',row));}
  return {...raw,metrics:{...m,per_horizon:[...m.per_horizon].sort((a,b)=>a.h-b.h)}};
}
function investReviewItems(value) {return Array.isArray(value)?value.filter(row=>row&&typeof row==='object'):[];}
function investPortfolioDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const stamp=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value?stamp:null;
}
function investPortfolioReturn(row,initial) {
  if(Object.hasOwn(row,'return'))return cockpitNumber(row.return);
  const nav=cockpitNumber(row.nav);
  return initial>0&&nav!==null?cockpitNumber(nav/initial-1):null;
}
function investPortfolioModel(raw) {
  const rows=raw?.portfolios??raw?.items;
  if(!Array.isArray(rows))throw cockpitError('invalidResponse');
  const seen=new Set();
  const position=(row,closed)=>{
    const pnl=cockpitNumber(Object.hasOwn(row,'pnl')?row.pnl:closed?row.realized_pnl:row.unrealized_pnl);
    const cost=cockpitNumber(row.entry_cost);
    const ret=Object.hasOwn(row,'return')?cockpitNumber(row.return):pnl!==null&&cost>0?cockpitNumber(pnl/cost):null;
    return {...row,pnl,return:ret,close_price:row.close_price??row.mark_price,stop_price:row.stop_price??row.invalidation_price,
      reason:row.reason??(closed?row.exit_reason:row.entry_reason)};
  };
  const entries=rows.map(row=>{
    if(typeof row?.expert_id!=='string'||!row.expert_id.trim()||seen.has(row.expert_id))throw cockpitError('invalidResponse');
    seen.add(row.expert_id);
    const initial=cockpitNumber(row.initial_cash??raw.initial_cash);
    const curve=investReviewItems(row.nav_history??row.curve).map(item=>({...item,date:item.date??item.session,return:investPortfolioReturn(item,initial)}));
    const positions=investReviewItems(row.open_positions??row.positions).map(item=>position(item,false));
    const closed=investReviewItems(row.closed_positions??row.closed).map(item=>position(item,true));
    const pending=investReviewItems(row.queued_orders??row.pending);
    const valued=curve.some(item=>cockpitNumber(item.nav)!==null||item.return!==null);
    return {...row,curve,positions,closed,pending,
      total_return:Object.hasOwn(row,'total_return')?cockpitNumber(row.total_return):valued?investPortfolioReturn(row,initial):null,
      max_drawdown:valued?row.max_drawdown:null,wins:row.closed_wins??row.wins,win_rate:row.closed_win_rate??row.win_rate};
  });
  return {...raw,items:entries,started_on:raw.started_on??raw.started_at,position_weight:raw.target_weight??raw.position_weight};
}
function investPortfolioPoints(rows,metric,startedOn) {
  const earliest=investPortfolioDate(startedOn),points=new Map();
  for(const row of investReviewItems(rows)){
    const stamp=investPortfolioDate(row.date);
    if(stamp===null||earliest!==null&&stamp<earliest)continue;
    points.set(stamp,{stamp,date:row.date,value:cockpitNumber(row[metric])});
  }
  return [...points.values()].sort((a,b)=>a.stamp-b.stamp);
}
function investPortfolioContributions(expert) {
  const stocks=new Map();
  for(const [rows,key] of [[expert.positions,'open'],[expert.closed,'closed']])for(const row of rows){
    if(typeof row.code!=='string'||!row.code)continue;
    if(!stocks.has(row.code))stocks.set(row.code,{code:row.code,name:row.name,open:{count:0,sum:0,missing:false},closed:{count:0,sum:0,missing:false}});
    const stock=stocks.get(row.code),entry=stock[key],value=cockpitNumber(row.pnl);
    if(!stock.name&&row.name)stock.name=row.name;
    entry.count++;
    if(value===null)entry.missing=true;else entry.sum+=value;
  }
  return [...stocks.values()].map(({code,name,open,closed})=>({code,name,open:open.count&&!open.missing?open.sum:null,
    closed:closed.count&&!closed.missing?closed.sum:null,total:open.missing||closed.missing?null:open.sum+closed.sum})).sort((a,b)=>a.code.localeCompare(b.code));
}
function investReviewId(value) {return typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=128&&!/[\\/?#\u0000-\u001f]/.test(value)&&value!=='.'&&value!=='..';}
function investReviewLegacy(detail) {const targets=investReviewItems(detail?.targets);return detail?.legacy===true||(targets.length>0&&targets.every(item=>!Array.isArray(item.plans)));}
function investReviewCanJudge(plan) {return investReviewId(plan?.plan_id)&&plan.plan_kind==='complex'&&plan.metrics?.status==='needs_ai'&&!plan.metrics.ai;}
// Exchange session clocks and quote provenance, independent of the machine's local zone.
function investPriceClock(ms) {return new Date(ms+8*3600000).toISOString().slice(0,19).replace('T',' ');}
function investPriceStamp(value) {
  if(typeof value==='string' && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(value)) {
    value=value.replace(' ','T');value=Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(value)?value:value+'+08:00');
  }
  return Number.isSafeInteger(value)&&value>0&&value<8640000000000000-28800000?value:null;
}
function investPriceDay(value) {
  const stamp=investPriceStamp(value);
  if(stamp!==null)return investPriceClock(stamp).slice(0,10);
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value))return null;
  const ms=Date.parse(value+'T00:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().startsWith(value+'T')?value:null;
}
function investPriceRow(data,target) {
  return Array.isArray(data?.items)?data.items.find(row=>row?.code===target.code&&(!target.thscode?.includes('.')||!row.thscode||target.thscode===row.thscode)):null;
}
function investPriceTimes(row,data) {
  const response=investPriceStamp(data?.timestamp);
  // MarketService inserts response.timestamp into a row when the feed omitted it.
  // It cannot prove the trade date (especially on weekends and market holidays).
  const rawTime=row?.trade_time_ms??row?.quote_time_ms??row?.trade_time??row?.quote_time;
  const market=investPriceStamp(rawTime)??(row?.timestamp!==data?.timestamp?investPriceStamp(row?.timestamp):null);
  const day=investPriceDay(row?.trade_date??row?.trade_date_ms??row?.date_ms??row?.date)??investPriceDay(market);
  const clock=typeof rawTime==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(rawTime)?rawTime:null;
  return {response,day,marketText:market!==null?investPriceClock(market):clock?[day,clock].filter(Boolean).join(' '):null};
}
function investPriceSession(ms,day) {
  const local=new Date(ms+28800000),midnight=ms-(local.getUTCHours()*3600000+local.getUTCMinutes()*60000+local.getUTCSeconds()*1000+local.getUTCMilliseconds());
  const minutes=(ms-midnight)/60000,weekend=[0,6].includes(local.getUTCDay()),today=local.toISOString().slice(0,10);
  const nominal=weekend?'priceWeekend':minutes<570?'pricePre':minutes<690?'priceTrading':minutes<780?'priceLunch':minutes<900?'priceTrading':'priceClosed';
  const status=!weekend&&minutes>=570&&day&&day<today?'priceNoToday':nominal;
  const boundary=(weekend?[]:[570,690,780,900]).find(m=>m>minutes)??1440;
  return {status,nominal,interval:status==='priceTrading'?15000:300000,nextBoundary:midnight+boundary*60000};
}
function createInvestStore(options) {
  options=options || {};
  const fetcher=options.fetch || ((...args)=>globalThis.fetch(...args)),schedule=options.schedule || setTimeout,unschedule=options.unschedule || clearTimeout,now=options.now || Date.now;
  const listeners=new Set(),requests=new Map(),versions=new Map();
  let disposed=false,connectionTimer,jobTimer,pollStarted=0,pollCount=0,pollEnabled=false;
  let selectionTimer,selectionStarted=0,selectionCount=0,selectionPolling=false,expertsInitialized=false;
  let factorTimer,factorStarted=0,factorCount=0,factorPolling=false,factorVisible=false,transcriptTimer;
  const selectionActiveStatuses=['queued','pending','running','cancelling'];
  let state={tab:'screen',target:null,stockCode:'',stockAsset:'个股',stockSearch:{...investIdle(),q:''},connection:{phase:'idle',ready:false,apiBase:'/dsh-super-trader/backend',error:null},status:null,factors:{code:'601088',category:'个股',timeframe:'1d',tab:'batch',ruleId:'',initialized:false,report:investIdle(),backtest:investIdle(),rules:investIdle()},factorResearch:{scope:'all',timeframe:'1d',workers:4,max_trials:5,brief:''},factorUniverse:investIdle(),factorResearchJob:{...investIdle(),submitting:false,cancelling:false,paused:false},factorResults:{...investIdle(),offset:0,limit:50,q:'',jobId:''},factorHistory:{...investIdle(),initialized:false},factorTranscript:{jobId:'',items:[],seq:0,phase:'idle',error:null,following:true,finalRead:false},report:investIdle(),screen:{scope:'market',sector:'',brief:''},selectionExpertIds:[],selectionAi:{phase:'idle',sessionId:null,requestId:null,error:null},selectionJob:{...investIdle(),params:null,paused:false,submitting:false,cancelling:false},sectors:{...investIdle(),tag:'industry',q:'',offset:0},selectedSector:null,experts:investIdle(),expertIds:[],expertEdit:null,expertCreating:false,expertSaving:false,expertDraft:null,expertError:null,expertDelete:{id:null,name:'',submitting:false,error:null},expertResearch:{phase:'idle',requirement:'',requestId:null,data:null,error:null},sectorAi:{phase:'idle',sessionId:null,requestId:null,error:null},stockAi:{phase:'idle',sessionId:null,requestId:null,error:null},watch:investIdle(),watchSearch:{...investIdle(),q:'',asset:'个股'},watchAi:{phase:'idle',sessionId:null,requestId:null,error:null},integration:investIdle(),portfolios:investIdle(),portfolioView:{expertId:'',hiddenExperts:[],benchmark:true,mode:'return'},reviews:investIdle(),reviewDetail:investIdle(),reviewJudge:investIdle(),reviewJudgeBatch:investIdle(),reviewId:'',reviewFocusPlanId:'',reviewSyncing:false,watchDeselected:[],add:investIdle(),draft:investIdle(),job:{...investIdle(),target:null,paused:false,submitting:false,cancelling:false},notice:null};
  Object.assign(state,{dailyHistory:investIdle(),dailyStart:investIdle(),reviewMode:'daily',scheme:'light',selectionFocus:0,watchQuotes:{...investIdle(),items:{}}});
  function publish(patch) {if(disposed)return;state={...state,...patch};for(const fn of listeners)fn();}
  function abort(key) {requests.get(key)?.abort();requests.delete(key);versions.set(key,(versions.get(key)||0)+1);}
  function token(key) {abort(key);const c=new AbortController();requests.set(key,c);return {c,v:versions.get(key)};}
  function current(key,t) {return !disposed&&!t.c.signal.aborted&&versions.get(key)===t.v;}
  async function request(path,init,signal,timeoutMs=30000) {
    const timeout=AbortSignal.timeout(timeoutMs);
    const response=await fetcher(state.connection.apiBase+'/api'+path,{...init,signal:signal?AbortSignal.any([signal,timeout]):timeout,headers:{...(init?.body?{'Content-Type':'application/json'}:{}),...init?.headers}});
    let data;try {data=await response.json();}catch {if(path.startsWith('/factors/')){if(!response.ok)throw Error('HTTP '+response.status);throw cockpitError('factorContractError',path+'：接口未返回可解析的JSON；不是股票代码无效。');}throw cockpitError('invalidResponse');}
    if(!response.ok)throw Error((path.startsWith('/factors/')?'HTTP '+response.status+': ':'')+investText(data?.error || data?.detail || response.status));
    return data;
  }
  async function resource(key,path,validate) {
    const t=token(key);publish({[key]:{...state[key],phase:'loading',error:null}});
    try {let data=await request(path,{method:'GET'},t.c.signal);if(validate)data=validate(data);if(current(key,t))publish({[key]:{...state[key],phase:'ready',data,error:null}});return current(key,t)?data:null;}
    catch(error){if(current(key,t))publish({[key]:{...state[key],phase:'error',error:cockpitFailure(error)}});}
    finally {if(requests.get(key)===t.c)requests.delete(key);}
  }
  // One owner, timer and in-flight quote. Research evidence stays frozen; only this
  // ephemeral view changes. The mounted Stock panel owns document visibility.
  let priceVisible=false,priceTimer,detachPrice,priceLast=0,priceAttempt=0,priceRetry=0;
  function stopPrice() {
    if(priceTimer!==undefined)unschedule(priceTimer);priceTimer=undefined;abort('stockPrice');
  }
  function resetPrice() {stopPrice();priceRetry=0;publish({stockPrice:null});}
  function priceSession() {
    const p=state.stockPrice;return investPriceSession(now(),p?investPriceTimes(investPriceRow(p.data,p.target),p.data).day:null);
  }
  function planPrice() {
    const p=state.stockPrice;
    if(!priceVisible||disposed||!p||requests.has('stockPrice')||priceTimer!==undefined)return;
    const session=priceSession(),at=now(),due=priceRetry?priceAttempt+priceRetry:priceLast+session.interval;
    // Boundary wakes only update the status on closing; an opening wakes the
    // feed even if yesterday's row still says no quote for today.
    const wake=Math.min(due,session.nextBoundary);
    priceTimer=schedule(()=>{
      priceTimer=undefined;
      if(!priceVisible||disposed||state.stockPrice!==p)return;
      const next=priceSession(),opened=next.nominal==='priceTrading'&&session.nominal!=='priceTrading';
      publish({stockPrice:{...p,asOf:now()}});
      if(opened||now()>=(priceRetry?priceAttempt+priceRetry:priceLast+next.interval))return refreshPrice();
      planPrice();
    },Math.max(0,wake-at));
  }
  async function refreshPrice() {
    const p=state.stockPrice;
    if(!priceVisible||disposed||!p||requests.has('stockPrice'))return;
    const tok=token('stockPrice'),fund=['ETF','LOF'].includes(p.target.category);
    try {
      const data=await request((fund?'/market/fund-quote?code=':'/market/quotes?codes=')+encodeURIComponent(p.target.code),{method:'GET'},tok.c.signal);
      if(!current('stockPrice',tok))return;
      if(cockpitNumber(investPriceRow(data,p.target)?.last_price)===null)throw cockpitError('priceNoRow');
      priceLast=now();priceRetry=0;publish({stockPrice:{...p,data,asOf:priceLast,error:null,missing:null}});
    } catch(error) {
      if(current('stockPrice',tok)){
        priceAttempt=now();priceRetry=Math.min(600000,Math.max(priceRetry,priceSession().interval)*2);
        publish({stockPrice:{...p,asOf:now(),error:cockpitFailure(error)}});
      }
    } finally {
      if(current('stockPrice',tok)){requests.delete('stockPrice');planPrice();}
    }
  }
  function seedPrice(report) {
    stopPrice();priceRetry=0;priceLast=now();
    publish({stockPrice:{target:report.target,data:report.quote?.available?report.quote.data:null,missing:report.quote?.error,error:null,asOf:priceLast}});planPrice();
  }
  function mountPrice(doc) {
    detachPrice?.();if(!doc||disposed)return;
    const sync=()=>{
      const visible=doc.visibilityState==='visible';if(visible===priceVisible)return;
      priceVisible=visible;if(!visible){stopPrice();return;}
      if(state.stockPrice){publish({stockPrice:{...state.stockPrice,asOf:now()}});if(now()-priceLast>=priceSession().interval){void refreshPrice();return;}}
      planPrice();
    };
    const detach=()=>{doc.removeEventListener('visibilitychange',sync);if(detachPrice===detach){detachPrice=null;priceVisible=false;stopPrice();}};
    detachPrice=detach;doc.addEventListener('visibilitychange',sync);sync();return detach;
  }
  function navigate(tab) {if(tab!=='stock')detachPrice?.();if(tab!=='factors')stopFactors();if(tab!=='screen')stopSelectionPolling();if(tab!=='experts')stopPolling();publish({tab,notice:null});options.onNavigate?.(tab);}
  function setTarget(next) {if(investTargetKey(next)!==investTargetKey(state.target)){resetPrice();abort('report');abort('draft');abort('add');publish({target:next,report:investIdle(),draft:investIdle(),add:investIdle(),notice:null});}}
  function setCode(code) {resetPrice();publish({stockCode:String(code).trim()});abort('report');abort('draft');abort('add');publish({target:null,report:investIdle(),draft:investIdle(),add:investIdle(),notice:null});}
  async function queryStock(code,name,category) {try {const requested=category;const target=investTarget('stock',code===undefined?state.stockCode:code,name,category);stopPrice();publish({stockCode:target.code});setTarget(target);const path='/research/stock?code='+target.code+(requested?'&category='+encodeURIComponent(requested):'');const data=await resource('report',path,raw=>investReport(raw,target));if(data&&investTargetKey(state.target)===investTargetKey(target)){const finalCategory=data.target.category || target.category;seedPrice(data);publish({stockAsset:finalCategory,target:{...target,name:data.target.name || target.name,category:finalCategory}});}return data;}catch(error){publish({notice:cockpitFailure(error)});}}
  async function openStock(code,name,category) {navigate('stock');return queryStock(code,name,category);}
  function setSearch(q) {abort('stockSearch');publish({stockSearch:{...investIdle(),q:String(q)}});}
  function searchStocks(category) {const asset=category || state.stockAsset || '个股';publish({stockAsset:asset});if(!state.stockSearch.q.trim())return;return resource('stockSearch','/market/search?'+new URLSearchParams({q:state.stockSearch.q.trim(),limit:'20'}),data=>{if(!Array.isArray(data?.items))throw cockpitError('invalidResponse');return data;});}
  async function querySector(item) {try {const target=investTarget('sector',item.thscode,item.name);publish({selectedSector:{thscode:target.code,name:target.name}});setTarget(target);return await resource('report','/research/sector?thscode='+encodeURIComponent(target.code),raw=>investReport(raw,target));}catch(error){publish({notice:cockpitFailure(error)});}}
  function selectSector(item) {try {const target=investTarget('sector',item.thscode,item.name);publish({selectedSector:{thscode:target.code,name:target.name}});setTarget(target);}catch(error){publish({notice:cockpitFailure(error)});}}
  function factorPublish(patch) {publish({factors:{...state.factors,...patch}});}
  function stopFactors() {factorVisible=false;stopFactorTranscript();stopFactorResearchPolling();for(const key of ['factorReport','factorBacktest','factorRules','factorUniverse','factorResults','factorHistory'])abort(key);for(const key of ['factorUniverse','factorResults','factorHistory'])if(state[key].phase==='loading')publish({[key]:{...state[key],phase:'idle',...(key==='factorHistory'?{initialized:false}:{})}});factorPublish({report:state.factors.report.phase==='loading'?investIdle():state.factors.report,backtest:state.factors.backtest.phase==='loading'?investIdle():state.factors.backtest,rules:state.factors.rules.phase==='loading'?investIdle():state.factors.rules});}
  function factorInput(patch) {
    abort('factorReport');abort('factorBacktest');
    const invalidTime=patch.timeframe!==undefined&&patch.timeframe!=='1d';
    factorPublish({code:patch.code===undefined?state.factors.code:String(patch.code).trim(),category:patch.category===undefined?state.factors.category:patch.category,timeframe:'1d',ruleId:state.factors.tab==='backtest'?state.factors.ruleId:'',report:invalidTime?{...investIdle(),phase:'error',error:{key:'factorInvalidTimeframe'}}:investIdle(),backtest:investIdle()});
  }
  function factorTarget() {const f=state.factors;investFactorCheck(['个股','ETF','指数'].includes(f.category),'target.category','个股/ETF/指数',f.category);return {code:investTarget('stock',f.code).code,timeframe:f.timeframe,category:f.category};}
  async function queryFactor() {
    abort('factorReport');abort('factorBacktest');factorPublish({ruleId:'',initialized:true,report:investIdle(),backtest:investIdle()});
    let target;try {target=factorTarget();if(target.timeframe!=='1d')throw cockpitError('factorInvalidTimeframe');}catch(error){factorPublish({report:{...investIdle(),phase:'error',error:cockpitFailure(error)}});return;}
    const tok=token('factorReport');factorPublish({report:{...investIdle(),phase:'loading'}});
    try {const raw=await request('/factors/stock?'+new URLSearchParams(target),{method:'GET'},tok.c.signal);if(!current('factorReport',tok))return;const data=investFactorReport(raw,target);factorPublish({report:{phase:'ready',data,error:null}});if(state.factors.tab==='backtest')return await selectFactorRule(data.rule.id);return data;}
    catch(error){if(current('factorReport',tok))factorPublish({report:{...investIdle(),phase:'error',error:cockpitFailure(error)}});}
    finally {if(requests.get('factorReport')===tok.c)requests.delete('factorReport');}
  }
  async function ensureFactors() {factorVisible=true;if(state.factorUniverse.phase==='idle')await loadFactorUniverse();if(!factorVisible||disposed)return;if(!state.factorHistory.initialized&&!state.factorResearchJob.data?.id){await restoreFactorResearch();return;}if(factorVisible){if(state.factorResearchJob.data?.id&&state.factorResults.phase==='idle')void loadFactorResults();resumeFactorResearchPolling();}}
  async function loadFactorRules() {
    const tok=token('factorRules');factorPublish({rules:{...investIdle(),phase:'loading'}});
    try {const data=await request('/factors/library?limit=500',{method:'GET'},tok.c.signal);investFactorCheck(Array.isArray(data?.items),'library.items','量化因子数组',data?.items);investFactorCheck(investFactorCount(data.total),'library.total','非负整数',data.total);data.items.forEach((row,i)=>{investFactorCheck(typeof row?.id==='string'&&!!row.id,'library.items['+i+'].id','非空量化因子ID',row?.id);investFactorCheck(typeof row.name==='string','library.items['+i+'].name','量化因子名称',row.name);if(row.accuracy!==null&&row.accuracy!==undefined)investFactorCheck(typeof row.accuracy==='number'&&row.accuracy>=0&&row.accuracy<=1,'library.items['+i+'].accuracy','0..1或null',row.accuracy);});if(current('factorRules',tok))factorPublish({rules:{phase:'ready',data,error:null}});}
    catch(error){if(current('factorRules',tok))factorPublish({rules:{...investIdle(),phase:'error',error:cockpitFailure(error)}});}
    finally {if(requests.get('factorRules')===tok.c)requests.delete('factorRules');}
  }
  async function selectFactorRule(id,details) {
    if(typeof id!=='string'||!id){factorPublish({backtest:{...investIdle(),phase:'error',error:{key:'factorContractError',detail:'rule.id：缺少非空量化因子ID；不能查询回测。这不是股票代码无效。'}}});return;}
    let target;try {target=factorTarget();}catch(error){factorPublish({ruleId:id,tab:details?'backtest':state.factors.tab,backtest:{...investIdle(),phase:'error',error:cockpitFailure(error)}});return;}
    abort('factorReport');const tok=token('factorBacktest');
    factorPublish({ruleId:id,initialized:true,tab:details?'backtest':state.factors.tab,report:state.factors.report.phase==='loading'?investIdle():state.factors.report,backtest:{...investIdle(),phase:'loading'}});
    try {const raw=await request('/factors/backtest?'+new URLSearchParams({...target,rule_id:id}),{method:'GET'},tok.c.signal);if(!current('factorBacktest',tok))return;const data=investFactorReport(raw,target,id);factorPublish({backtest:{phase:'ready',data,error:null}});return data;}
    catch(error){if(current('factorBacktest',tok))factorPublish({backtest:{...investIdle(),phase:'error',error:cockpitFailure(error)}});}
    finally {if(requests.get('factorBacktest')===tok.c)requests.delete('factorBacktest');}
  }
  function factorTab(tab) {
    if(!['batch','rules','backtest'].includes(tab))return;
    factorPublish({tab});
    if(tab==='rules'&&state.factors.rules.phase==='idle')void loadFactorRules();
    if(tab==='backtest'&&state.factors.backtest.phase==='idle'){const id=state.factors.ruleId || state.factors.report.data?.rule?.id;if(id)void selectFactorRule(id);}
  }
  function factorResearchOptions(patch) {publish({factorResearch:{...state.factorResearch,...patch,scope:'all',timeframe:'1d'}});}
  function activeFactorResearch() {const j=state.factorResearchJob;return j.submitting||j.cancelling||selectionActiveStatuses.includes(j.data?.status);}
  function validateFactorResearch(job,id) {
    const check=investFactorCheck;
    check(typeof job?.id==='string'&&!!job.id&&(!id||job.id===id),'job.id',id||'非空任务ID',job?.id);
    check(selectionActiveStatuses.includes(job.status)||terminal(job.status),'job.status','已约定任务状态',job.status);
    if(job.type!==undefined)check(job.type==='factor_research','job.type','factor_research',job.type);
    const r=job.result;
    if(r){
      check(r.kind==='factor_research','job.result.kind','factor_research',r.kind);check(['all','targets'].includes(r.scope),'job.result.scope','all或targets',r.scope);check(r.timeframe==='1d','job.result.timeframe','1d',r.timeframe);
      investFactorUniverse({...r.universe,timeframe:r.timeframe});
      if(r.scope==='all')check(r.targets===null,'job.result.targets','全量范围必须为null',r.targets);
      else {check(Array.isArray(r.targets),'job.result.targets','带类别的标的ID数组',r.targets);r.targets.forEach((id,i)=>check(typeof id==='string'&&/^(?:个股|ETF|指数):\d{6}$/.test(id),'job.result.targets['+i+']','个股/ETF/指数:6位代码',id));check(investFactorCount(r.scope_total)&&r.scope_total===new Set(r.targets).size,'job.result.scope_total','显式子集去重标的数',r.scope_total);}
      check(typeof r.phase?.name==='string','job.result.phase.name','阶段名称',r.phase?.name);
      for(const key of ['target_done','target_total'])check(investFactorCount(r.phase?.[key]),'job.result.phase.'+key,'非负整数',r.phase?.[key]);
      check(r.phase.target_done<=r.phase.target_total,'job.result.phase.target_done','不大于target_total',r.phase.target_done);
      for(const key of ['rules_written','trials_completed','targets_evaluated','targets_failed','targets_skipped','best_updates','model_calls'])check(investFactorCount(r.counters?.[key]),'job.result.counters.'+key,'非负整数',r.counters?.[key]);
      for(const key of ['activity','errors','warnings'])check(Array.isArray(r[key]),'job.result.'+key,'数组',r[key]);
      check(r.activity.length<=20,'job.result.activity','最近最多20条',r.activity.length);
    }
    return job;
  }
  function factorTranscriptFollowing(value) {if(state.factorTranscript.following!==(value===true))publish({factorTranscript:{...state.factorTranscript,following:value===true}});}
  function stopFactorTranscript() {if(transcriptTimer!==undefined)unschedule(transcriptTimer);transcriptTimer=undefined;abort('factorTranscript');if(state.factorTranscript.phase==='loading')publish({factorTranscript:{...state.factorTranscript,phase:state.factorTranscript.items.length?'ready':'idle'}});}
  function resetFactorTranscript(id) {stopFactorTranscript();publish({factorTranscript:{jobId:id||'',items:[],seq:0,phase:'idle',error:null,following:true,finalRead:false}});}
  function syncFactorTranscript() {
    const j=state.factorResearchJob,id=j.data?.id;if(!id||!factorVisible||disposed)return;
    if(state.factorTranscript.jobId!==id)resetFactorTranscript(id);
    if(j.paused&&!terminal(j.data.status)||state.factorTranscript.finalRead&&terminal(j.data.status)||requests.has('factorTranscript'))return;
    if(terminal(j.data.status)&&transcriptTimer!==undefined){unschedule(transcriptTimer);transcriptTimer=undefined;}
    if(transcriptTimer===undefined)void pollFactorTranscript();
  }
  async function pollFactorTranscript() {
    transcriptTimer=undefined;const j=state.factorResearchJob,id=j.data?.id,previous=state.factorTranscript;
    if(!id||!factorVisible||disposed||j.paused&&!terminal(j.data.status)||previous.jobId!==id||previous.finalRead&&terminal(j.data.status)||requests.has('factorTranscript'))return;
    let drain=false;const after=previous.seq,final=terminal(j.data.status),t=token('factorTranscript');publish({factorTranscript:{...previous,phase:'loading',error:null}});
    try {
      const data=await request('/factors/research/'+encodeURIComponent(id)+'/transcript?'+new URLSearchParams({after:String(after),limit:'200'}),{method:'GET'},t.c.signal),check=investFactorCheck;
      if(!current('factorTranscript',t)||state.factorResearchJob.data?.id!==id||state.factorTranscript.jobId!==id)return;
      check(data?.job_id===id,'transcript.job_id',id,data?.job_id);check(Array.isArray(data.items)&&data.items.length<=200,'transcript.items','最多200条增量输出',data.items);
      let last=after;
      data.items.forEach((item,i)=>{const p='transcript.items['+i+']';check(Number.isSafeInteger(item?.seq)&&item.seq>last,p+'.seq','严格递增且大于after的整数',item?.seq);last=item.seq;check(['thinking','content','tool','error','status'].includes(item.kind),p+'.kind','thinking/content/tool/error/status',item.kind);check(typeof item.text==='string',p+'.text','真实输出文本',item.text);check(typeof item.at==='string',p+'.at','输出时间',item.at);if(item.kind==='tool')check(typeof item.tool==='string'&&item.tool.length>0,p+'.tool','工具名称',item.tool);else check(item.tool===null||item.tool===undefined||typeof item.tool==='string',p+'.tool','null或工具名称',item.tool);});
      check(Number.isSafeInteger(data.next_seq)&&data.next_seq===last,'transcript.next_seq','最后一条seq（空页保留after）',data.next_seq);check(typeof data.has_more==='boolean','transcript.has_more','布尔值',data.has_more);check(!data.has_more||last>after,'transcript.has_more','有更多内容时游标必须前进',data.has_more);
      publish({factorTranscript:{...state.factorTranscript,items:[...state.factorTranscript.items,...data.items],seq:last,phase:'ready',error:null,finalRead:final&&!data.has_more}});
      if(factorVisible&&(!state.factorResearchJob.paused||terminal(state.factorResearchJob.data?.status))&&(!state.factorTranscript.finalRead||!terminal(state.factorResearchJob.data?.status))){drain=data.has_more||!final&&terminal(state.factorResearchJob.data?.status);if(!drain)transcriptTimer=schedule(pollFactorTranscript,factorTranscriptDelay());}
    }catch(error){if(current('factorTranscript',t)){publish({factorTranscript:{...state.factorTranscript,phase:'error',error:cockpitFailure(error)}});if(factorVisible&&!state.factorResearchJob.paused&&!terminal(state.factorResearchJob.data?.status))transcriptTimer=schedule(pollFactorTranscript,1000);}}
    finally {if(requests.get('factorTranscript')===t.c)requests.delete('factorTranscript');if(drain&&current('factorTranscript',t)&&factorVisible&&(!state.factorResearchJob.paused||terminal(state.factorResearchJob.data?.status)))void pollFactorTranscript();}
  }
  function retryFactorTranscript() {stopFactorTranscript();syncFactorTranscript();}
  function loadFactorUniverse() {return resource('factorUniverse','/factors/universe',investFactorUniverse);}
  function stopFactorResearchPolling() {factorPolling=false;if(factorTimer!==undefined)unschedule(factorTimer);factorTimer=undefined;abort('factorResearchPoll');}
  async function loadFactorResults(offset) {
    const id=state.factorResearchJob.data?.id;if(!id)return;
    const r=state.factorResults,page=offset===undefined?r.offset:Math.max(0,offset),t=token('factorResults');
    publish({factorResults:{...r,data:r.jobId===id&&r.offset===page?r.data:null,offset:page,jobId:id,phase:'loading',error:null}});
    try {
      const data=await request('/factors/results?'+new URLSearchParams({job_id:id,offset:String(page),limit:'50',q:r.q.trim()}),{method:'GET'},t.c.signal),check=investFactorCheck;
      check(Array.isArray(data?.items),'results.items','分页成果数组',data?.items);check(investFactorCount(data.total),'results.total','非负整数',data.total);check(data.offset===page&&data.limit===50,'results.offset/limit',page+'/50',{offset:data.offset,limit:data.limit});check(data.items.length<=50,'results.items','最多50条',data.items.length);
      data.items.forEach((row,i)=>{const p='results.items['+i+']';check(!!row&&typeof row==='object',p,'成果对象',row);check(['个股','ETF','指数'].includes(row.category),p+'.category','个股/ETF/指数',row.category);check(/^\d{6}$/.test(row.code),p+'.code','6位代码',row.code);check(row.target_id===row.category+':'+row.code,p+'.target_id',row.category+':'+row.code,row.target_id);check(row.timeframe==='1d',p+'.timeframe','1d',row.timeframe);for(const key of ['accuracy','coverage'])check(investFactorRatio(row[key]),p+'.'+key,'0–1数值或null',row[key]);check(row.direction===null||[-1,0,1].includes(row.direction),p+'.direction','-1/0/1或null（暂无量化因子）',row.direction);for(const key of ['name','status'])check(typeof row[key]==='string',p+'.'+key,'字符串',row[key]);for(const key of ['rule_id','rule_name','as_of'])check(row[key]===null||typeof row[key]==='string',p+'.'+key,'字符串或null（暂无量化因子）',row[key]);if(row.rule_id!==null){for(const key of ['rule_id','rule_name','as_of'])check(typeof row[key]==='string'&&row[key].length>0,p+'.'+key,'已验证best的非空字符串',row[key]);check([-1,0,1].includes(row.direction),p+'.direction','已验证best的-1/0/1方向',row.direction);}else{check(row.rule_name===null&&row.as_of===null&&row.direction===null&&row.accuracy===null&&row.coverage===null,p+'.best','无best时rule_name/as_of/direction/accuracy/coverage均为null',row);}});
      check(new Set(data.items.map(row=>row.target_id)).size===data.items.length,'results.items.target_id','同页唯一标的',data.items.map(row=>row.target_id));
      if(current('factorResults',t)&&state.factorResearchJob.data?.id===id)publish({factorResults:{...state.factorResults,phase:'ready',data,error:null}});
    }catch(error){if(current('factorResults',t))publish({factorResults:{...state.factorResults,phase:'error',error:cockpitFailure(error)}});}
    finally {if(requests.get('factorResults')===t.c)requests.delete('factorResults');}
  }
  function factorResultsQuery(q) {abort('factorResults');publish({factorResults:{...investIdle(),q:String(q),offset:0,limit:50,jobId:state.factorResearchJob.data?.id||''}});}
  async function openFactorResult(row) {factorInput({code:row.code,category:row.category});factorPublish({tab:'backtest',ruleId:''});if(typeof row.rule_id==='string'&&row.rule_id)return selectFactorRule(row.rule_id,true);}
  function factorPollDelay(){const e=now()-factorStarted;return e>=1800000?15000:e>=300000?5000:2000;}
  function factorTranscriptDelay(){const e=now()-factorStarted;return e>=1800000?5000:e>=600000?3000:1000;}
  async function pollFactorResearch() {
    const j=state.factorResearchJob,id=j.data?.id;if(!id||terminal(j.data.status)||disposed||!factorPolling||!factorVisible||j.cancelling)return;
    const t=token('factorResearchPoll');factorCount++;
    try {
      const raw=await request('/jobs/'+encodeURIComponent(id),{method:'GET'},t.c.signal);if(!current('factorResearchPoll',t)||state.factorResearchJob.data?.id!==id)return;
      const job=validateFactorResearch(raw.job||raw,id);publish({factorResearchJob:{...state.factorResearchJob,phase:'ready',data:job,error:null,paused:false}});syncFactorTranscript();
      if(factorVisible&&state.factorResults.phase!=='loading')void loadFactorResults();
      if(!terminal(job.status)&&factorPolling&&factorVisible)factorTimer=schedule(pollFactorResearch,factorPollDelay());
    }catch(error){if(current('factorResearchPoll',t)){publish({factorResearchJob:{...state.factorResearchJob,error:cockpitFailure(error)}});if(factorVisible&&factorPolling&&!terminal(state.factorResearchJob.data?.status))factorTimer=schedule(pollFactorResearch,10000);}}
    finally {if(requests.get('factorResearchPoll')===t.c)requests.delete('factorResearchPoll');}
  }
  function resumeFactorResearchPolling(manual) {
    stopFactorResearchPolling();const j=state.factorResearchJob;if(!factorVisible||!j.data?.id)return;
    if(manual){factorStarted=now();factorCount=0;publish({factorResearchJob:{...j,paused:false}});}
    syncFactorTranscript();if(terminal(j.data.status)||j.cancelling||state.factorResearchJob.paused)return;factorPolling=true;void pollFactorResearch();
  }
  async function restoreFactorResearch() {
    if(state.factorResearchJob.data?.id||state.factorResearchJob.submitting||state.factorHistory.phase==='loading')return;
    const t=token('factorHistory');publish({factorHistory:{...investIdle(),phase:'loading',initialized:true}});
    try {
      const data=await request('/jobs?limit=10',{method:'GET'},t.c.signal);investFactorCheck(Array.isArray(data?.items),'jobs.items','作业数组',data?.items);
      if(!current('factorHistory',t)||state.factorResearchJob.data?.id||state.factorResearchJob.submitting)return;
      const saved=data.items.find(job=>job.type==='factor_research');
      if(saved){const job=validateFactorResearch(saved);publish({factorResearchJob:{...investIdle(),phase:'ready',data:job,submitting:false,cancelling:false,paused:false},factorResults:{...investIdle(),q:'',offset:0,limit:50,jobId:job.id}});factorStarted=now();factorCount=0;if(factorVisible){void loadFactorResults(0);resumeFactorResearchPolling();}}
      publish({factorHistory:{phase:'ready',data:{found:!!saved},error:null,initialized:true}});
    }catch(error){if(current('factorHistory',t))publish({factorHistory:{phase:'error',data:null,error:cockpitFailure(error),initialized:true}});}
    finally {if(requests.get('factorHistory')===t.c)requests.delete('factorHistory');}
  }
  async function startFactorResearch(confirmed) {
    if(confirmed!==true){publish({factorResearchJob:{...state.factorResearchJob,error:{key:'consentRequired'}}});return;}
    if(activeFactorResearch()||state.factorHistory.phase==='loading')return;
    const p=state.factorResearch,body={...p,scope:'all',timeframe:'1d',brief:p.brief.trim()};delete body.max_model_calls;delete body.minutes;
    if(![2,4,8].includes(body.workers)||['max_trials'].some(key=>!Number.isSafeInteger(body[key])||body[key]<1)||Array.from(body.brief).length>1000){publish({factorResearchJob:{...state.factorResearchJob,error:{key:'factorResearchInvalid'}}});return;}
    stopFactorResearchPolling();resetFactorTranscript('');const t=token('factorResearchSubmit');abort('factorResults');
    publish({factorResearchJob:{...investIdle(),phase:'loading',submitting:true,cancelling:false,paused:false},factorResults:{...investIdle(),q:'',offset:0,limit:50,jobId:''}});
    try {
      const raw=await request('/factors/research',{method:'POST',body:JSON.stringify(body)},t.c.signal);if(!current('factorResearchSubmit',t))return;
      const accepted=validateFactorResearch(raw?.job?{...raw.job,result:undefined}:null);
      let job;try {job=validateFactorResearch(raw.job);}catch(error){publish({factorResearchJob:{phase:'error',data:accepted,error:cockpitFailure(error),submitting:false,cancelling:false,paused:false}});if(accepted?.id){factorStarted=now();factorCount=0;if(factorVisible)resumeFactorResearchPolling();}return;}
      publish({factorResearchJob:{phase:'ready',data:job,error:null,submitting:false,cancelling:false,paused:false}});factorStarted=now();factorCount=0;
      if(factorVisible){void loadFactorResults(0);resumeFactorResearchPolling();}
    }catch(error){if(current('factorResearchSubmit',t))publish({factorResearchJob:{...state.factorResearchJob,phase:'error',submitting:false,error:cockpitFailure(error)}});}
    finally {if(requests.get('factorResearchSubmit')===t.c)requests.delete('factorResearchSubmit');}
  }
  async function cancelFactorResearch() {
    const j=state.factorResearchJob,id=j.data?.id;if(!id||terminal(j.data.status)||j.cancelling)return;
    stopFactorResearchPolling();const t=token('factorResearchCancel');publish({factorResearchJob:{...j,cancelling:true}});
    try {
      const raw=await request('/jobs/'+encodeURIComponent(id)+'/cancel',{method:'POST'},t.c.signal);if(!current('factorResearchCancel',t)||state.factorResearchJob.data?.id!==id)return;
      const incoming=raw.job||raw,job=validateFactorResearch({...j.data,...incoming,result:incoming.result??j.data.result},id);publish({factorResearchJob:{...state.factorResearchJob,data:job,error:null,cancelling:false}});
      if(factorVisible){void loadFactorResults();syncFactorTranscript();if(!state.factorResearchJob.paused)resumeFactorResearchPolling();}
    }catch(error){if(current('factorResearchCancel',t)){publish({factorResearchJob:{...state.factorResearchJob,error:cockpitFailure(error),cancelling:false}});if(state.factorResearchJob.data?.id&&!terminal(state.factorResearchJob.data.status))resumeFactorResearchPolling();}}
    finally {if(requests.get('factorResearchCancel')===t.c)requests.delete('factorResearchCancel');}
  }
  function screenOptions(patch) {
    const scope=['market','watchlist','sector'].includes(patch.scope)?patch.scope:state.screen.scope;
    publish({screen:{scope,sector:scope==='sector'?String(patch.sector ?? state.screen.sector ?? ''):'',brief:patch.brief===undefined?state.screen.brief:String(patch.brief)},notice:null});
  }
  function screen(confirmed,onOpenSession) {if(confirmed!==true){publish({notice:{key:'consentRequired'}});return;}return startSelectionAnalysis(onOpenSession);}
  function screenSector() {if(!state.selectedSector)return;screenOptions({scope:'sector',sector:state.selectedSector.thscode});navigate('screen');}
  function sectorOptions(patch) {abort('sectors');publish({sectors:{...state.sectors,...patch,offset:patch.offset ?? 0,phase:'idle',data:null,error:null}});}
  function loadSectors(offset) {const s=state.sectors;const page=offset ?? s.offset;publish({sectors:{...s,offset:page}});return resource('sectors','/market/sectors?'+new URLSearchParams({tag:s.tag,q:s.q,offset:String(page),limit:'30'}),data=>{if(!Array.isArray(data?.items))throw cockpitError('invalidResponse');return data;});}
  function loadExperts() {
    return resource('experts','/experts',data=>{if(!Array.isArray(data?.items)||data.items.some(e=>typeof e.id!=='string'))throw cockpitError('invalidResponse');return data;}).then(data=>{
      if(data){const ids=data.items.filter(e=>e.enabled!==false).map(e=>e.id);publish({expertIds:expertsInitialized?state.expertIds.filter(id=>ids.includes(id)):[...ids],selectionExpertIds:expertsInitialized?state.selectionExpertIds.filter(id=>ids.includes(id)):[...ids]});expertsInitialized=true;}
    });
  }
  function editExpert(id) {if(state.expertSaving||state.expertDelete.submitting||state.expertResearch.phase==='submitting')return;const e=state.experts.data?.items.find(x=>x.id===id);if(!e)return;publish({expertEdit:id,expertCreating:false,expertError:null,expertDraft:{id:e.id,name:e.name||'',tag:e.tag||'',criteria:Array.isArray(e.criteria)?e.criteria.join('\n'):(e.criteria||''),system_prompt:e.system_prompt||''}});}
  function cancelExpertEdit() {if(state.expertSaving)return;publish({expertEdit:null,expertCreating:false,expertDraft:null,expertError:null});}
  function newExpert() {if(state.expertSaving||state.expertDelete.submitting||state.expertResearch.phase==='submitting')return;publish({expertEdit:null,expertCreating:true,expertError:null,expertDraft:null,expertResearch:{phase:'idle',requirement:'',requestId:null,data:null,error:null}});}
  function cancelNewExpert() {if(state.expertResearch.phase==='submitting')return;publish({expertCreating:false});}
  function expertRequirement(value) {if(state.expertResearch.phase==='submitting')return;publish({expertResearch:{phase:'idle',requirement:String(value),requestId:null,data:null,error:null}});}
  async function startExpertCreation(onOpenSession) {
    const r=state.expertResearch;if(state.expertDelete.submitting||r.phase==='submitting'||r.data?.submitted===true)return;
    const requirement=r.requirement.trim();
    if(!requirement||requirement.length>8000){publish({expertResearch:{...r,error:'请描述想创建的专家（1–8000 字符）。'}});return;}
    if(typeof onOpenSession!=='function'){publish({expertResearch:{...r,error:'当前桌面客户端未提供会话导航能力，请刷新后重试。'}});return;}
    const requestId=r.requestId??(options.createRequestId?.()??globalThis.crypto?.randomUUID?.()??('expert-'+now().toString(16)+'-'+Math.random().toString(16).slice(2)));
    publish({expertResearch:{...r,phase:'submitting',requestId,error:null}});
    const navigation=onOpenSession.begin?.();
    let receipt;
    try{
      const response=await fetcher(options.expertCreationEndpoint??'/dsh-super-trader/expert-creation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requirement,request_id:requestId}),signal:AbortSignal.timeout(120000)});
      const data=await response.json();
      if(!response.ok){receipt=data?.sessionId?data:null;throw Error(investText(data?.error||'AI 创建未启动'));}
      if(data?.submitted!==true||data.status!=='accepted'||typeof data.sessionId!=='string'||typeof data.workspaceId!=='string')throw Error('未收到有效的任务受理回执；请重试同一请求。');
      receipt=data;publish({expertCreating:false,expertResearch:{...r,phase:'accepted',requestId,data,error:null}});
      if(!disposed&&!navigation?.aborted)await onOpenSession(data.sessionId);
      return data;
    }catch(error){
      publish({expertResearch:{...r,phase:receipt?.submitted?'accepted':'error',requestId,data:receipt,error:investText(error?.message||error)}});
    }
  }
  function openExpertCreationSession(onOpenSession) {const id=state.expertResearch.data?.sessionId;if(id&&typeof onOpenSession==='function')onOpenSession(id);}
  async function startSectorAnalysis(onOpenSession) {
    const a=state.sectorAi;
    if(a.phase==='submitting')return;
    if(typeof onOpenSession!=='function'){publish({sectorAi:{...a,error:'当前桌面客户端未提供会话导航能力，请刷新后重试。'}});return;}
    if(!state.target||state.target.kind!=='sector'||!/^\d{6}\.(?:SH|SZ|TI)$/.test(state.target.code)){publish({sectorAi:{...a,error:'请先选择一个完整板块。'}});return;}
    const requestId=a.requestId??(globalThis.crypto?.randomUUID?.()??('sector-'+now().toString(16)+'-'+Math.random().toString(16).slice(2)));
    publish({sectorAi:{...a,phase:'submitting',requestId,error:null}});
    let data=null;
    try{
      const response=await fetcher('/dsh-super-trader/sector-analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({thscode:state.target.code,name:state.target.name||state.target.code,request_id:requestId}),signal:AbortSignal.timeout(120000)});
      data=await response.json();
      if(!response.ok){const sessionId=data?.sessionId||a.sessionId||null;throw Object.assign(Error(investText(data?.error||'AI 板块分析未启动')),{sessionId});}
      if(data?.submitted!==true||typeof data.sessionId!=='string'||typeof data.workspaceId!=='string')throw Error('未收到有效的分析受理回执');
      publish({sectorAi:{phase:'ready',sessionId:data.sessionId,requestId,error:null}});
      await onOpenSession(data.sessionId);
      return data;
    }catch(error){
      publish({sectorAi:{phase:'error',sessionId:error?.sessionId||data?.sessionId||a.sessionId||null,requestId,error:investText(error?.message||error)}});
    }
  }
  function openSectorAnalysisSession(onOpenSession) {const id=state.sectorAi.sessionId;if(id&&typeof onOpenSession==='function')onOpenSession(id);}
  async function startStockAnalysis(onOpenSession) {
    const a=state.stockAi;
    if(a.phase==='submitting')return;
    if(typeof onOpenSession!=='function'){publish({stockAi:{...a,error:'当前桌面客户端未提供会话导航能力，请刷新后重试。'}});return;}
    if(!state.target||state.target.kind!=='stock'||!/^\d{6}$/.test(state.target.code)){publish({stockAi:{...a,error:'请先选择一个六位个股。'}});return;}
    const targetKey=investTargetKey(state.target),retry=a.phase==='error'&&a.targetKey===targetKey&&!a.submitted;
    const requestId=(retry?a.requestId:null)??(globalThis.crypto?.randomUUID?.()??('stock-'+now().toString(16)+'-'+Math.random().toString(16).slice(2)));
    publish({stockAi:{...a,phase:'submitting',targetKey,submitted:false,sessionId:retry?a.sessionId:null,requestId,error:null}});
    let data=null;
    try{
      const response=await fetcher('/dsh-super-trader/stock-analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:state.target.code,name:state.target.name||state.target.code,request_id:requestId}),signal:AbortSignal.timeout(120000)});
      data=await response.json();
      if(!response.ok){const sessionId=data?.sessionId||a.sessionId||null;throw Object.assign(Error(investText(data?.error||'AI 个股分析未启动')),{sessionId});}
      if(data?.submitted!==true||typeof data.sessionId!=='string'||typeof data.workspaceId!=='string')throw Error('未收到有效的分析受理回执');
      publish({stockAi:{phase:'ready',targetKey,submitted:true,sessionId:data.sessionId,requestId,error:null}});
      await onOpenSession(data.sessionId);
      return data;
    }catch(error){
      const submitted=data?.submitted===true&&typeof data.sessionId==='string'&&typeof data.workspaceId==='string';
      publish({stockAi:{phase:submitted?'ready':'error',targetKey,submitted,sessionId:error?.sessionId||data?.sessionId||(retry?a.sessionId:null)||null,requestId,error:investText(error?.message||error)}});
    }
  }
  function openStockAnalysisSession(onOpenSession) {const id=state.stockAi.sessionId;if(id&&typeof onOpenSession==='function')onOpenSession(id);}
  function watchKey(item) {return String(item?.code||'')+'|'+String(item?.category||'');}
  function toggleWatchSelected(key) {const next=new Set(state.watchDeselected);if(next.has(key))next.delete(key);else next.add(key);publish({watchDeselected:[...next]});}
  function selectAllWatch(selected) {const items=state.watch.data?.items||[];publish({watchDeselected:selected?[]:items.map(watchKey)});}
  function selectedWatchItems() {const items=state.watch.data?.items||[],off=new Set(state.watchDeselected);return items.filter(item=>!off.has(watchKey(item)));}
  async function startWatchlistAnalysis(onOpenSession) {
    const a=state.watchAi;
    if(a.phase==='submitting')return;
    if(typeof onOpenSession!=='function'){publish({watchAi:{...a,error:'当前桌面客户端未提供会话导航能力，请刷新后重试。'}});return;}
    const items=selectedWatchItems();
    if(!items.length){publish({watchAi:{...a,error:'请至少勾选一只自选股。'}});return;}
    const targetKey=items.map(watchKey).sort().join(','),retry=a.phase==='error'&&a.targetKey===targetKey&&!a.submitted;
    const requestId=(retry?a.requestId:null)??(globalThis.crypto?.randomUUID?.()??('watch-'+now().toString(16)+'-'+Math.random().toString(16).slice(2)));
    publish({watchAi:{...a,phase:'submitting',targetKey,submitted:false,sessionId:retry?a.sessionId:null,requestId,error:null}});
    let data=null;
    try{
      const response=await fetcher('/dsh-super-trader/watchlist-analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items.map(item=>({code:item.code,name:item.name||item.code,category:item.category})),request_id:requestId}),signal:AbortSignal.timeout(120000)});
      data=await response.json();
      if(!response.ok){const sessionId=data?.sessionId||a.sessionId||null;throw Object.assign(Error(investText(data?.error||'AI 自选股分析未启动')),{sessionId});}
      if(data?.submitted!==true||typeof data.sessionId!=='string'||typeof data.workspaceId!=='string')throw Error('未收到有效的分析受理回执');
      publish({watchAi:{phase:'ready',targetKey,submitted:true,sessionId:data.sessionId,requestId,error:null}});
      await onOpenSession(data.sessionId);
      return data;
    }catch(error){
      const submitted=data?.submitted===true&&typeof data.sessionId==='string'&&typeof data.workspaceId==='string';
      publish({watchAi:{phase:submitted?'ready':'error',targetKey,submitted,sessionId:error?.sessionId||data?.sessionId||(retry?a.sessionId:null)||null,requestId,error:investText(error?.message||error)}});
    }
  }
  function openWatchlistAnalysisSession(onOpenSession) {const id=state.watchAi.sessionId;if(id&&typeof onOpenSession==='function')onOpenSession(id);}
  async function loadIntegration() {
    if(state.integration.phase==='loading')return;
    publish({integration:{...investIdle(),phase:'loading'}});
    try {
      const response=await fetcher('/dsh-super-trader/integration',{headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const data=await response.json();
      if(!data||typeof data!=='object'||typeof data.available!=='boolean')throw cockpitError('invalidResponse');
      publish({integration:{phase:'ready',data,error:null}});
    } catch(error) {
      publish({integration:{phase:'error',data:null,error:cockpitFailure(error)}});
    }
  }
  function loadPortfolios() {
    if(state.portfolios.phase==='loading')return;
    return resource('portfolios','/portfolios',investPortfolioModel);
  }
  function portfolioMode(mode) {
    if(['return','nav'].includes(mode))publish({portfolioView:{...state.portfolioView,mode}});
  }
  function portfolioExpert(id) {
    if(state.portfolios.data?.items.some(row=>row.expert_id===id))publish({portfolioView:{...state.portfolioView,expertId:id}});
  }
  function togglePortfolioSeries(id) {
    if(!state.portfolios.data?.items.some(row=>row.expert_id===id))return;
    const v=state.portfolioView;
    publish({portfolioView:{...v,hiddenExperts:v.hiddenExperts.includes(id)?v.hiddenExperts.filter(expertId=>expertId!==id):[...v.hiddenExperts,id]}});
  }
  function togglePortfolioBenchmark() {
    publish({portfolioView:{...state.portfolioView,benchmark:!state.portfolioView.benchmark}});
  }
  const dailyRoute='/dsh-super-trader/daily-review';
  function dailySessionRow(row){return investPortfolioDate(row?.date)!==null&&investReviewId(row.sessionId);}
  async function loadDailyHistory(){
    const t=token('dailyHistory');publish({dailyHistory:{...state.dailyHistory,phase:'loading',error:null}});
    try{
      const res=await fetcher(dailyRoute,{signal:AbortSignal.any([t.c.signal,AbortSignal.timeout(15000)])});
      const data=await res.json();if(!res.ok||!Array.isArray(data?.items))throw Error(investText(data?.error)||'HTTP '+res.status);
      if(current('dailyHistory',t))publish({dailyHistory:{phase:'ready',error:null,data:data.items.filter(dailySessionRow).sort((a,b)=>b.date.localeCompare(a.date))}});
    }catch(error){if(current('dailyHistory',t))publish({dailyHistory:{...state.dailyHistory,phase:'error',error:cockpitFailure(error)}});}
    finally{if(requests.get('dailyHistory')===t.c)requests.delete('dailyHistory');}
  }
  async function startDailyReview(open){
    if(state.dailyStart.phase==='loading'||typeof open!=='function')return;
    const t=token('dailyStart'), navigation=open.begin?.();publish({dailyStart:{...investIdle(),phase:'loading'}});
    try{
      const res=await fetcher(dailyRoute,{method:'POST',signal:AbortSignal.any([t.c.signal,AbortSignal.timeout(110000)])});
      const data=await res.json();if(!current('dailyStart',t))return;
      if(!res.ok||!dailySessionRow(data))throw Error(investText(data?.error)||'HTTP '+res.status);
      if(!navigation?.aborted)open(data.sessionId);
      publish({dailyStart:{phase:'ready',data,error:null}});void loadDailyHistory();
    }catch(error){if(current('dailyStart',t)){publish({dailyStart:{...investIdle(),phase:'error',error:cockpitFailure(error)}});void loadDailyHistory();}}
    finally{if(requests.get('dailyStart')===t.c)requests.delete('dailyStart');}
  }
  function openDailyReview(date,open){const row=state.dailyHistory.data?.find(r=>r.date===date);if(row&&typeof open==='function')open(row.sessionId);}
  function closeReviewReference(){publish({reviewMode:'daily',reviewFocusPlanId:''});}
  let followLatestReview=true;
  async function loadReviews({refresh=false}={}) {
    const data=await resource('reviews','/reviews',raw=>{
      if(!Array.isArray(raw?.items))throw cockpitError('invalidResponse');
      return {...raw,items:investReviewItems(raw.items).filter(row=>investReviewId(row.id))};
    });
    if(!data)return;
    // The service returns newest first. A historical/exact selection must not be
    // replaced by a list request finishing after the user selected it.
    const id=followLatestReview?(data.items[0]?.id||''):state.reviewId;
    if(!id&&state.reviewId){abort('reviewDetail');publish({reviewId:'',reviewDetail:investIdle(),reviewFocusPlanId:''});}
    else if(id&&(id!==state.reviewId||state.reviewDetail.phase==='idle'||refresh&&state.reviewDetail.phase!=='loading')){
      if(id!==state.reviewId)publish({reviewFocusPlanId:''});
      await fetchReview(id);
    }
    return data;
  }
  async function refreshReviews() {
    if(state.reviews.phase==='loading')return;
    // Refreshing still updates the open detail when the history endpoint fails.
    const data=await loadReviews({refresh:true});
    if(!data&&state.reviewId&&state.reviewDetail.phase!=='loading')await fetchReview(state.reviewId);
    return data;
  }
  async function syncReviews() {
    if(state.reviewSyncing)return;
    publish({reviewSyncing:true,notice:null});
    try {await request('/reviews/sync',{method:'POST'});return await refreshReviews();}
    catch(error){publish({notice:cockpitFailure(error)});}
    finally{publish({reviewSyncing:false});}
  }
  async function deleteReview(id) {
    if(!investReviewId(id)||state.reviewJudge.phase==='loading')return;
    try{
      await request('/reviews/'+encodeURIComponent(id),{method:'DELETE'});
      if(state.reviewId===id){followLatestReview=true;abort('reviewDetail');publish({reviewId:'',reviewDetail:investIdle(),reviewFocusPlanId:''});}
      await loadReviews();
    }catch(error){publish({notice:cockpitFailure(error)});}
  }
  async function judgeReview(id,planId,consent) {
    if(consent!==true||id!==state.reviewId||state.reviewDetail.phase!=='ready'||investReviewLegacy(state.reviewDetail.data)||state.reviewJudge.phase==='loading')return;
    const allowed=investReviewItems(state.reviewDetail.data?.targets).some(item=>investReviewItems(item.plans).some(plan=>plan.plan_id===planId&&investReviewCanJudge(plan)));
    if(!allowed)return;
    const t=token('reviewJudge'),identity={reviewId:id,planId};
    publish({reviewJudge:{...investIdle(),...identity,phase:'loading'}});
    try{
      // Never send an unscoped {} or a stock code: old bulk judging must not run.
      const data=await request('/reviews/'+encodeURIComponent(id)+'/judge',{method:'POST',body:JSON.stringify({plan_ids:[planId]})},t.c.signal,270000);
      if(!current('reviewJudge',t))return;
      if(data?.review_id!==id||!['judged','skipped','errors'].every(key=>Array.isArray(data[key])))throw cockpitError('invalidResponse');
      if(state.reviewId===id)await fetchReview(id);
      if(current('reviewJudge',t))publish({reviewJudge:{phase:'ready',...identity,data,error:null}});
      return data;
    }catch(error){
      if(current('reviewJudge',t))publish({reviewJudge:{phase:'error',...identity,data:null,error:cockpitFailure(error)}});
    }finally{if(requests.get('reviewJudge')===t.c)requests.delete('reviewJudge');}
  }
  async function judgeBatch(id,planIds,consent) {
    if(consent!==true||id!==state.reviewId||state.reviewDetail.phase!=='ready'||investReviewLegacy(state.reviewDetail.data)||state.reviewJudgeBatch.phase==='loading')return;
    const ids=(Array.isArray(planIds)?planIds:[]).filter(plan=>typeof plan==='string'&&/^[A-Za-z0-9_.:|/-]{1,160}$/.test(plan));
    if(!ids.length)return;
    const t=token('reviewJudgeBatch');
    publish({reviewJudgeBatch:{...investIdle(),phase:'loading'}});
    try{
      // One explicit user action, every listed plan: force re-runs existing judgments.
      const data=await request('/reviews/'+encodeURIComponent(id)+'/judge',{method:'POST',body:JSON.stringify({plan_ids:ids,force:true})},t.c.signal,270000);
      if(!current('reviewJudgeBatch',t))return;
      if(data?.review_id!==id||!['judged','skipped','errors'].every(key=>Array.isArray(data[key])))throw cockpitError('invalidResponse');
      if(state.reviewId===id)await fetchReview(id);
      if(current('reviewJudgeBatch',t))publish({reviewJudgeBatch:{phase:'ready',data,error:null}});
      return data;
    }catch(error){
      if(current('reviewJudgeBatch',t))publish({reviewJudgeBatch:{phase:'error',data:null,error:cockpitFailure(error)}});
    }finally{if(requests.get('reviewJudgeBatch')===t.c)requests.delete('reviewJudgeBatch');}
  }
  function fetchReview(id) {
    if(id!==state.reviewId)publish({reviewId:id,reviewDetail:investIdle()});
    return resource('reviewDetail','/reviews/'+encodeURIComponent(id),data=>{
      if(!data||!Array.isArray(data.targets)||data.id!==undefined&&data.id!==id)throw cockpitError('invalidResponse');
      return data;
    });
  }
  function openReview(id,planId) {
    if(!investReviewId(id))return;
    followLatestReview=id===state.reviews.data?.items?.[0]?.id;
    publish({reviewFocusPlanId:investReviewId(planId)?planId:'',notice:null});
    return fetchReview(id);
  }
  function openReviewReference(id,planId) {
    if(!investReviewId(id))return;
    // Pin the exact linked batch before changing native panels; the list may mount
    // immediately, and must not redirect an explicit reference to the latest batch.
    followLatestReview=false;
    publish({reviewMode:'source',reviewFocusPlanId:investReviewId(planId)?planId:''});
    const detail=fetchReview(id);
    navigate('review');
    return detail;
  }
  function updateExpertDraft(patch) {if(!state.expertSaving)publish({expertDraft:{...state.expertDraft,...patch},expertError:null});}
  async function saveExpert() {
    const d=state.expertDraft;if(!d||!state.expertEdit||state.expertSaving||state.expertDelete.submitting)return;
    if(!d.name.trim()||!d.system_prompt.trim()){publish({expertError:'名称和方法论不能为空'});return;}
    const body={name:d.name.trim(),tag:d.tag.trim(),criteria:d.criteria.split('\n').map(x=>x.trim()).filter(Boolean),system_prompt:d.system_prompt};
    if(!state.expertCreating&&d.id)body.id=d.id;
    if(state.expertCreating)body.tools=(d.tools||'').split(/[\n,]+/).map(x=>x.trim()).filter(Boolean);
    publish({expertSaving:true,expertError:null});
    try{
      const saved=await request('/experts',{method:'POST',body:JSON.stringify(body)});
      if(typeof saved?.id!=='string'||!saved.id)throw cockpitError('invalidResponse');
      publish({expertEdit:null,expertCreating:false,expertDraft:null,expertError:null});
      await loadExperts();
      return saved;
    }catch(err){publish({expertError:investText(err?.message || err)});}
    finally{publish({expertSaving:false});}
  }
  function requestExpertDelete(id) {
    if(state.expertDelete.submitting||state.expertSaving||state.expertResearch.phase==='submitting')return;
    const expert=state.experts.data?.items.find(e=>e.id===id);if(!expert)return;
    publish({expertDelete:{id,name:expert.name||id,submitting:false,error:null}});
  }
  function cancelExpertDelete() {if(!state.expertDelete.submitting)publish({expertDelete:{id:null,name:'',submitting:false,error:null}});}
  async function confirmExpertDelete() {
    const pending=state.expertDelete,id=pending.id;if(!id||pending.submitting||state.expertSaving)return;
    publish({expertDelete:{...pending,submitting:true,error:null}});
    try{
      const result=await request('/experts/'+encodeURIComponent(id),{method:'DELETE'});
      if(result?.deleted!==id)throw cockpitError('invalidResponse');
      abort('experts');
      publish({expertDelete:{id:null,name:'',submitting:false,error:null},
        expertIds:state.expertIds.filter(value=>value!==id),selectionExpertIds:state.selectionExpertIds.filter(value=>value!==id),
        experts:{...state.experts,phase:'ready',data:{...state.experts.data,items:(state.experts.data?.items||[]).filter(e=>e.id!==id)}},
        ...(state.expertEdit===id?{expertEdit:null,expertDraft:null,expertError:null}:{})});
      await loadExperts();return result;
    }catch(error){publish({expertDelete:{...pending,submitting:false,error:investText(error?.message||error)}});}
  }
  function toggleExpert(id) {const expert=state.experts.data?.items.find(e=>e.id===id);if(!expert||expert.enabled===false)return;publish({expertIds:state.expertIds.includes(id)?state.expertIds.filter(v=>v!==id):[...state.expertIds,id]});}
  function toggleSelectionExpert(id) {const expert=state.experts.data?.items.find(e=>e.id===id);if(!expert||expert.enabled===false)return;publish({selectionExpertIds:state.selectionExpertIds.includes(id)?state.selectionExpertIds.filter(v=>v!==id):[...state.selectionExpertIds,id],notice:null});}
  function activeSelection() {return state.selectionJob.submitting || state.selectionJob.cancelling || selectionActiveStatuses.includes(state.selectionJob.data?.status);}
  function selectionBody() {const s=state.screen;return {scope:s.scope,...(s.scope==='sector'?{sector:s.sector.trim().toUpperCase()}:{}),expert_ids:[...state.selectionExpertIds],brief:s.brief.trim(),limit_per_expert:5};}
  function validateSelection(job,id,params) {
    if(!job||typeof job.id!=='string'||!job.id||id&&job.id!==id||typeof job.status!=='string')throw cockpitError('invalidResponse');
    const r=job.result;
    if(r){
      if(r.kind!=='expert_selection'||r.scope!==params.scope||(r.sector || '')!==(params.sector || '')||r.brief!==params.brief||r.limit_per_expert!==5||!Array.isArray(r.expert_results)||r.expert_results.some(e=>!params.expert_ids.includes(e.expert?.id)||!Array.isArray(e.picks)||e.picks.some(p=>!/^\d{6}$/.test(p.code))))throw cockpitError('invalidResponse');
    }
    return job;
  }
  function stopSelectionPolling() {selectionPolling=false;if(selectionTimer!==undefined)unschedule(selectionTimer);selectionTimer=undefined;abort('selectionPoll');}
  async function pollSelection() {
    const j=state.selectionJob,id=j.data?.id;
    if(!id||terminal(j.data.status)||disposed||!selectionPolling||j.cancelling)return;
    if(selectionCount>=300||now()-selectionStarted>=600000){stopSelectionPolling();publish({selectionJob:{...state.selectionJob,paused:true}});return;}
    const t=token('selectionPoll');selectionCount++;
    try {
      const raw=await request('/jobs/'+encodeURIComponent(id),{method:'GET'},t.c.signal);
      if(!current('selectionPoll',t)||state.selectionJob.data?.id!==id)return;
      const job=validateSelection(raw.job || raw,id,j.params);
      publish({selectionJob:{...state.selectionJob,phase:'ready',data:job,error:null,paused:false}});
      if(!terminal(job.status)&&selectionPolling&&listeners.size)selectionTimer=schedule(pollSelection,1800);
    }catch(error){if(current('selectionPoll',t))publish({selectionJob:{...state.selectionJob,phase:'error',error:cockpitFailure(error),paused:true}});}
    finally {if(requests.get('selectionPoll')===t.c)requests.delete('selectionPoll');}
  }
  function resumeSelectionPolling(manual) {
    stopSelectionPolling();const j=state.selectionJob;selectionPolling=true;
    if(!j.data?.id||terminal(j.data.status)||j.cancelling)return;
    if(manual){selectionStarted=now();selectionCount=0;publish({selectionJob:{...j,paused:false}});}
    if(!state.selectionJob.paused)void pollSelection();
  }
  async function startSelection(confirmed) {
    if(state.expertDelete.submitting)return;
    if(confirmed!==true){publish({notice:{key:'consentRequired'}});return;}
    if(activeSelection()){publish({notice:{key:'activeJob'}});return;}
    const body=selectionBody();
    if(body.scope==='sector'&&!body.sector){publish({notice:{key:'selectionMissingSector'}});return;}
    if(body.scope==='sector'){try {investTarget('sector',body.sector);}catch(error){publish({notice:cockpitFailure(error)});return;}}
    if(Array.from(body.brief).length>1000){publish({notice:{key:'selectionBriefLong'}});return;}
    const enabled=state.experts.data?.items.filter(e=>e.enabled!==false) || [];
    if(!body.expert_ids.length)body.expert_ids=enabled.map(e=>e.id);
    if(!body.expert_ids.length||body.expert_ids.some(id=>!enabled.some(e=>e.id===id))){publish({notice:{key:'selectExpert'}});return;}
    const params={...body,expert_ids:[...body.expert_ids],experts:body.expert_ids.map(id=>{const e=enabled.find(x=>x.id===id);return {id,name:e.name || id,tag:e.tag || ''};}),sectorName:body.scope==='sector'?state.selectedSector?.name || body.sector:''};
    const t=token('selectionSubmit'),watch=selectionPolling;stopSelectionPolling();selectionPolling=watch;
    publish({selectionJob:{...investIdle(),phase:'loading',params,submitting:true,cancelling:false,paused:false},notice:null});
    try {
      const raw=await request('/research/select',{method:'POST',body:JSON.stringify(body)},t.c.signal);
      if(!current('selectionSubmit',t))return;
      // Retain a real accepted ID even if its inline result violates the schema.
      // This prevents a malformed result from inviting a duplicate model submission.
      const envelope=validateSelection(raw?.job?{...raw.job,result:undefined}:null,null,params);
      let job;try {job=validateSelection(raw.job,null,params);}catch(error){publish({selectionJob:{phase:'error',params,data:envelope,error:cockpitFailure(error),submitting:false,cancelling:false,paused:true}});return;}
      publish({selectionJob:{phase:'ready',params,data:job,error:null,submitting:false,cancelling:false,paused:false}});
      selectionStarted=now();selectionCount=0;
      if(selectionPolling&&listeners.size)void pollSelection();
    }catch(error){if(current('selectionSubmit',t))publish({selectionJob:{...state.selectionJob,phase:'error',submitting:false,error:cockpitFailure(error)}});}
    finally {if(requests.get('selectionSubmit')===t.c)requests.delete('selectionSubmit');}
  }
  async function startSelectionAnalysis(onOpenSession) {
    const a=state.selectionAi;
    if(a.phase==='submitting')return;
    if(typeof onOpenSession!=='function'){publish({selectionAi:{...a,error:'当前桌面客户端未提供会话导航能力，请刷新后重试。'}});return;}
    const body=selectionBody();
    if(body.scope==='sector'){if(!body.sector){publish({notice:{key:'selectionMissingSector'}});return;}try{investTarget('sector',body.sector);}catch(error){publish({notice:{key:'selectionMissingSector'}});return;}}
    if(Array.from(body.brief).length>1000){publish({notice:{key:'selectionBriefLong'}});return;}
    delete body.expert_ids;
    const targetKey=JSON.stringify(body),retry=a.phase==='error'&&a.targetKey===targetKey&&!a.submitted;
    const requestId=(retry?a.requestId:null)??(globalThis.crypto?.randomUUID?.()??('selection-'+now().toString(16)+'-'+Math.random().toString(16).slice(2)));
    publish({selectionAi:{...a,phase:'submitting',targetKey,submitted:false,sessionId:retry?a.sessionId:null,requestId,error:null}});
    let data=null;
    try{
      const response=await fetcher('/dsh-super-trader/selection-analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,request_id:requestId}),signal:AbortSignal.timeout(120000)});
      data=await response.json();
      if(!response.ok){const sessionId=data?.sessionId||a.sessionId||null;throw Object.assign(Error(investText(data?.error||'AI 专家选股未启动')),{sessionId});}
      if(data?.submitted!==true||typeof data.sessionId!=='string'||typeof data.workspaceId!=='string')throw Error('未收到有效的分析受理回执');
      publish({selectionAi:{phase:'ready',targetKey,submitted:true,sessionId:data.sessionId,requestId,error:null}});
      await onOpenSession(data.sessionId);
      return data;
    }catch(error){
      const submitted=data?.submitted===true&&typeof data.sessionId==='string'&&typeof data.workspaceId==='string';
      publish({selectionAi:{phase:submitted?'ready':'error',targetKey,submitted,sessionId:error?.sessionId||data?.sessionId||(retry?a.sessionId:null)||null,requestId,error:investText(error?.message||error)}});
    }
  }
  function openSelectionAnalysisSession(onOpenSession) {const id=state.selectionAi.sessionId;if(id&&typeof onOpenSession==='function')onOpenSession(id);}
  async function cancelSelection() {
    const j=state.selectionJob,id=j.data?.id;if(!id||terminal(j.data.status)||j.cancelling)return;
    const watch=selectionPolling;stopSelectionPolling();selectionPolling=watch;const t=token('selectionCancel');publish({selectionJob:{...j,cancelling:true}});
    try {
      const raw=await request('/jobs/'+encodeURIComponent(id)+'/cancel',{method:'POST'},t.c.signal);
      if(!current('selectionCancel',t)||state.selectionJob.data?.id!==id)return;
      const incoming=raw.job || raw;
      // Cancellation endpoints can return a compact job; preserve partial evidence.
      const job=validateSelection({...j.data,...incoming},id,j.params);
      publish({selectionJob:{...state.selectionJob,data:job,error:null,cancelling:false,paused:false}});
      if(!terminal(job.status)&&selectionPolling&&listeners.size)resumeSelectionPolling();
    }catch(error){if(current('selectionCancel',t))publish({selectionJob:{...state.selectionJob,error:cockpitFailure(error),cancelling:false,paused:true}});}
    finally {if(requests.get('selectionCancel')===t.c)requests.delete('selectionCancel');}
  }
  const watchStockCategory='个股';
  async function loadWatchQuotes(items,key) {
    const codes=[...new Set((Array.isArray(items)?items:[]).filter(item=>item?.category===watchStockCategory).map(item=>item.code).filter(code=>typeof code==='string'&&/^\d{6}$/.test(code)))].slice(0,50);
    if(!codes.length){publish({watchQuotes:{...investIdle(),items:{},key}});return;}
    const t=token('watchQuotes');publish({watchQuotes:{...state.watchQuotes,phase:'loading',error:null,key}});
    try {
      const data=await request('/market/quotes?'+new URLSearchParams({codes:codes.join(',')}),{method:'GET'},t.c.signal,15000);
      const map={};
      for(const row of Array.isArray(data?.items)?data.items:[]){const price=cockpitNumber(row?.last_price);if(typeof row?.code==='string'&&price!==null&&price>0)map[row.code]={price,change:cockpitNumber(row.price_change_ratio_pct)};}
      if(current('watchQuotes',t))publish({watchQuotes:{phase:'ready',data:null,error:null,items:map,time:data?.timestamp??null,key}});
    } catch(error){if(current('watchQuotes',t))publish({watchQuotes:{...state.watchQuotes,phase:'error',error:cockpitFailure(error),key}});}
    finally {if(requests.get('watchQuotes')===t.c)requests.delete('watchQuotes');}
  }
  function loadWatch() {return resource('watch','/watchlist',data=>{if(!Array.isArray(data?.items))throw cockpitError('invalidResponse');return data;});}
  async function addWatch(code, category) {
    if(state.add.phase==='loading')return;
    try {
      const raw=String(code || (state.target?.kind==='stock'?state.target.code:'') || '').trim();
      const asset=category==='ETF'||category==='LOF'?category:'个股';
      const c=investTarget('stock',raw,undefined,asset);
      const t=token('add');publish({add:{phase:'loading',data:null,error:null,code:c.code,category:asset}});
      try {const data=await request('/watchlist',{method:'POST',body:JSON.stringify({code:c.code,category:asset})},t.c.signal);if(current('add',t))publish({add:{phase:'ready',data:{...data,category:asset},error:null,code:c.code,category:asset},watch:investIdle()});}
      catch(error){if(current('add',t))publish({add:{phase:'error',data:null,error:cockpitFailure(error),code:c.code,category:asset}});}
    } catch(error){publish({notice:cockpitFailure(error)});}
  }
  function setWatchQuery(q) {publish({watchSearch:{...state.watchSearch,q:String(q)}});}
  async function removeWatch(code, category) {
    try {
      await request('/watchlist?'+new URLSearchParams({code:String(code),category:String(category)}),{method:'DELETE'},token('add').c.signal);
      publish({watch:investIdle(),add:investIdle()});
    } catch(error){publish({notice:cockpitFailure(error)});}
  }
  function searchWatch(category) {
    const asset=category || state.watchSearch.asset || '个股';
    const q=String(state.watchSearch.q||'').trim();
    if(!q)return;
    publish({watchSearch:{...state.watchSearch,asset,q}});
    return resource('watchSearch','/market/search?'+new URLSearchParams({q,limit:'20'}),data=>{
      if(!Array.isArray(data?.items))throw cockpitError('invalidResponse');
      return data;
    });
  }
  function stopPolling() {pollEnabled=false;if(jobTimer!==undefined)unschedule(jobTimer);jobTimer=undefined;abort('poll');}
  function activeJob() {return state.job.submitting || ['queued','pending','running','cancelling'].includes(state.job.data?.status);}
  function terminal(status) {return ['completed','succeeded','done','failed','error','cancelled','canceled','interrupted'].includes(status);}
  async function pollJob() {
    const id=state.job.data?.id;if(!id||terminal(state.job.data.status)||disposed||!pollEnabled)return;
    if(pollCount>=150||now()-pollStarted>=300000){publish({job:{...state.job,paused:true}});return;}
    const t=token('poll');pollCount++;
    try {
      const raw=await request('/jobs/'+encodeURIComponent(id),{method:'GET'},t.c.signal),job=raw.job || raw;
      if(!job || job.id!==id)throw cockpitError('invalidResponse');
      if(!current('poll',t)||state.job.data?.id!==id)return;
      if(job.result && (job.result.kind!==state.job.target.kind || investTargetKey(investTarget(job.result.kind,job.result.kind==='sector' ? job.result.target?.thscode || job.result.target?.code : job.result.target?.code))!==investTargetKey(state.job.target)))throw cockpitError('invalidResponse');
      publish({job:{...state.job,phase:'ready',data:job,error:null,paused:false}});
      if(!terminal(job.status)&&listeners.size)jobTimer=schedule(pollJob,1800);
    }catch(error){if(current('poll',t))publish({job:{...state.job,phase:'error',error:cockpitFailure(error),paused:true}});}
    finally {if(requests.get('poll')===t.c)requests.delete('poll');}
  }
  function resumePolling(manual) {stopPolling();pollEnabled=true;if(!state.job.data?.id||terminal(state.job.data.status))return;if(manual){pollStarted=now();pollCount=0;publish({job:{...state.job,paused:false}});}if(!state.job.paused)void pollJob();}
  async function startTeam(confirmed) {
    if(state.expertDelete.submitting)return;
    if(confirmed!==true){publish({notice:{key:'consentRequired'}});return;}
    if(activeJob()){publish({notice:{key:'activeJob'}});return;}
    if(!state.target){publish({notice:{key:'chooseTarget'}});return;}
    if(!state.expertIds.length){publish({notice:{key:'selectExpert'}});return;}
    const target={...state.target},ids=[...state.expertIds],t=token('submit'),watchJob=pollEnabled;stopPolling();pollEnabled=watchJob;publish({job:{...investIdle(),phase:'loading',target,submitting:true,paused:false},notice:null});
    try {const raw=await request('/research/team',{method:'POST',body:JSON.stringify({kind:target.kind,code:target.code,expert_ids:ids})},t.c.signal);if(!raw?.job?.id)throw cockpitError('invalidResponse');if(current('submit',t)){publish({job:{phase:'ready',target,data:raw.job,error:null,submitting:false,paused:false}});pollStarted=now();pollCount=0;if(listeners.size)void pollJob();}}
    catch(error){if(current('submit',t))publish({job:{...state.job,phase:'error',submitting:false,error:cockpitFailure(error)}});}
    finally {if(requests.get('submit')===t.c)requests.delete('submit');}
  }
  async function cancelJob() {const id=state.job.data?.id;if(!id||terminal(state.job.data.status)||state.job.cancelling)return;stopPolling();const t=token('cancel');publish({job:{...state.job,cancelling:true}});try {const raw=await request('/jobs/'+encodeURIComponent(id)+'/cancel',{method:'POST'},t.c.signal);const job=raw.job || raw;if(!job||job.id!==id)throw cockpitError('invalidResponse');if(current('cancel',t)){publish({job:{...state.job,data:job,error:null,cancelling:false,paused:false}});if(!terminal(job.status)){pollStarted=now();pollCount=0;resumePolling();}}}catch(error){if(current('cancel',t))publish({job:{...state.job,error:cockpitFailure(error),cancelling:false,paused:true}});}}
  async function draft(callback,t) {if(!state.report.data||state.draft.phase==='loading')return;const key=investTargetKey(state.target),tok=token('draft');const report=state.report.data;const evidence={kind:report.kind,target:report.target,created_at:report.created_at,quant:{as_of:report.quant.as_of,agreement:report.quant.agreement,items:report.quant.items.map(i=>({horizon:i.horizon,available:i.available,result:i.available?{direction:i.result.direction,probability:i.result.probability,sample:i.result.sample,evaluation:i.result.evaluation}:null}))},trend:report.trend.available?report.trend.data:null,history:report.history.available?{source:report.history.data.source,adjust:report.history.data.adjust,timestamp:report.history.data.timestamp,bars:report.history.data.items.length}:null};const prompt=t('disclaimer')+'\n'+t('teamIntro')+'\nDATA_EVIDENCE_JSON\n'+investText(evidence,24000);publish({draft:{phase:'loading',data:null,error:null,prompt}});try {const data=await callback(prompt);if(data?.accepted===false)throw cockpitError('requestFailed');if(current('draft',tok)&&key===investTargetKey(state.target))publish({draft:{phase:'ready',data,error:null,prompt}});}catch(error){if(current('draft',tok)&&key===investTargetKey(state.target))publish({draft:{phase:'error',data:null,error:cockpitFailure(error),prompt}});}}
  async function checkConnection() {const t=token('connection');try {const response=await fetcher('/dsh-super-trader/base',{signal:AbortSignal.any([t.c.signal,AbortSignal.timeout(6000)])});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(typeof data.apiBase!=='string'||!data.apiBase.startsWith('/')||data.apiBase.startsWith('//')||/[?#]/.test(data.apiBase))throw cockpitError('invalidResponse');if(!current('connection',t))return;publish({connection:{...data,ready:false,error:data.lastError?cockpitFailure(Error(investText(data.lastError))):null}});if(['running','external'].includes(data.phase)){const status=await request('/status',{method:'GET'},t.c.signal);if(status?.ok!==true)throw cockpitError('invalidResponse');if(current('connection',t))publish({status,connection:{...data,ready:true,error:null}});}}catch(error){if(current('connection',t))publish({connection:{...state.connection,phase:'error',ready:false,error:cockpitFailure(error)}});}finally {if(current('connection',t)&&listeners.size)connectionTimer=schedule(checkConnection,10000);}}
  async function retryConnection() {try {const res=await fetcher('/dsh-super-trader/retry',{method:'POST',signal:AbortSignal.timeout(30000)});if(!res.ok)throw Error('HTTP '+res.status);if(connectionTimer!==undefined)unschedule(connectionTimer);await checkConnection();}catch(error){publish({connection:{...state.connection,error:cockpitFailure(error)}});}}
  // Presentation only: the effective colour scheme picks a layout, it never re-requests data.
  function setSelectionFocus(index) {if(Number.isInteger(index)&&index>=0&&index!==state.selectionFocus)publish({selectionFocus:index});}
  function setScheme(scheme) {const next=scheme==='dark'?'dark':'light';if(state.scheme!==next)publish({scheme:next});}
  function subscribe(fn) {listeners.add(fn);if(listeners.size===1&&options.autoConnect!==false)void checkConnection();return()=>{listeners.delete(fn);if(!listeners.size){if(connectionTimer!==undefined)unschedule(connectionTimer);abort('connection');stopPolling();stopSelectionPolling();stopFactors();}};}
  function dispose() {detachPrice?.();stopPrice();stopFactorTranscript();stopFactorResearchPolling();factorVisible=false;disposed=true;if(connectionTimer!==undefined)unschedule(connectionTimer);stopPolling();stopSelectionPolling();for(const c of requests.values())c.abort();requests.clear();listeners.clear();}
  return {subscribe,getSnapshot:()=>state,mountPrice,setScheme,setSelectionFocus,navigate,setCode,setSearch,searchStocks,queryStock,openStock,querySector,selectSector,screenOptions,screen,screenSector,sectorOptions,loadSectors,loadExperts,toggleExpert,toggleSelectionExpert,loadPortfolios,portfolioMode,portfolioExpert,togglePortfolioSeries,togglePortfolioBenchmark,loadDailyHistory,startDailyReview,openDailyReview,closeReviewReference,loadReviews,refreshReviews,syncReviews,openReview,openReviewReference,judgeReview,judgeBatch,deleteReview,loadIntegration,startSelectionAnalysis,openSelectionAnalysisSession,editExpert,cancelExpertEdit,newExpert,cancelNewExpert,expertRequirement,startExpertCreation,openExpertCreationSession,startSectorAnalysis,openSectorAnalysisSession,startStockAnalysis,openStockAnalysisSession,updateExpertDraft,saveExpert,requestExpertDelete,cancelExpertDelete,confirmExpertDelete,startSelection,cancelSelection,resumeSelectionPolling,stopSelectionPolling,loadWatch,loadWatchQuotes,addWatch,removeWatch,searchWatch,setWatchQuery,toggleWatchSelected,selectAllWatch,startWatchlistAnalysis,openWatchlistAnalysisSession,startTeam,cancelJob,resumePolling,stopPolling,checkConnection,retryConnection,draft,factorInput,queryFactor,ensureFactors,loadFactorRules,selectFactorRule,factorTab,stopFactors,factorResearchOptions,activeFactorResearch,loadFactorUniverse,startFactorResearch,cancelFactorResearch,resumeFactorResearchPolling,stopFactorResearchPolling,restoreFactorResearch,loadFactorResults,factorResultsQuery,openFactorResult,factorTranscriptFollowing,retryFactorTranscript,dispose};
}
// Resolve only factual leaves in the exact saved source, never executable paths.
function investEvidenceReference(source,pointer) {
  const ancestors=[];
  if(!source||typeof pointer!=='string'||!pointer.startsWith('/data/'))return {found:false,ancestors};
  const segments=pointer.slice(1).split('/');let value=source,field='';
  for(const raw of segments){
    if(/~(?![01])/.test(raw))return {found:false,ancestors};
    const key=raw.replace(/~1/g,'/').replace(/~0/g,'~');
    if(['__proto__','prototype','constructor'].includes(key)||!value||typeof value!=='object')return {found:false,ancestors};
    if(value.available===false)return {found:false,ancestors,unavailable:true};
    if(Array.isArray(value)&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length))return {found:false,ancestors};
    if(!Object.hasOwn(value,key))return {found:false,ancestors};
    ancestors.push(value);value=value[key];field=key;
  }
  if(value!==null&&(typeof value==='object'||typeof value==='number'&&!Number.isFinite(value)||!['string','number','boolean'].includes(typeof value)))return {found:false,ancestors};
  return {found:true,value,field,ancestors};
}
function createInvestComponents(React,store) {
  const h=React.createElement;
  const useStore=()=>React.useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
  const num=(v,s='')=>cockpitNumber(v)===null?'—':v.toLocaleString(undefined,{maximumFractionDigits:3})+s;
  const pct=v=>cockpitNumber(v)===null?'—':num(v*100,'%');
 const trendOf=v=>cockpitNumber(v)===null||v===0?'flat':v>0?'up':'down';
 const signedPct=v=>cockpitNumber(v)===null?'—':(v>0?'+':v<0?'−':'')+num(Math.abs(v),'%');
  const time=v=>typeof v==='number'?new Date(v).toLocaleString(undefined,{timeZone:'Asia/Shanghai',hour12:false}):investText(v)||'—';
  const day=v=>new Date(v+28800000).toISOString().slice(0,10);
  function Button(p) {return h('button',{...p,type:p.type || 'button',primary:undefined,danger:undefined,className:'sti-btn'+(p.primary?' sti-primary':'')+(p.danger?' sti-danger':'')},p.children);}
  function ErrorView({error,t}) {return error?h('p',{className:'sti-error',role:'alert'},t(error.key || 'requestFailed')+(error.detail?': '+error.detail:'')):null;}
  function Warnings({items}) {return items?.length?h('ul',{className:'sti-warnings'},...items.map((s,i)=>h('li',{key:i},investText(s)))):null;}
  function Empty({children}) {return h('p',{className:'sti-empty'},children);}
  function Card({title,children,className=''}) {return h('section',{className:'sti-card '+className},h('h2',null,title),children);}
  function Metric({label,value}) {return h('div',{className:'sti-metric'},h('dt',null,label),h('dd',null,value));}
  function Status({resource,t}) {return resource.phase==='loading'?h('p',{role:'status'},t('loading')):h(ErrorView,{error:resource.error,t});}
  function Table({heads,rows,minWidth,className}) {return h('div',{className:'sti-table-scroll'},h('table',{...(minWidth?{style:{minWidth}}:{}),...(className?{className}:{})},h('thead',null,h('tr',null,...heads.map((s,i)=>s&&typeof s==='object'?h('th',{key:i,scope:'col',className:s.className},s.label):h('th',{key:i,scope:'col'},s)))),h('tbody',null,...rows)));}
  function StockActions({item,t}) {return h('div',{className:'sti-actions'},h(Button,{primary:true,onClick:()=>store.openStock(item.code,item.name)},t('research')),h(Button,{onClick:()=>store.addWatch(item.code)},t('addWatch')));}
  function SelectionData({value,depth=0}) {
    if(value===null||value===undefined)return h('span',null,'—');
    if(typeof value!=='object')return h('span',null,investText(value,900));
    if(depth>=3)return h('span',null,Array.isArray(value)?'['+value.length+']':Object.keys(value).slice(0,8).join(' · '));
    if(Array.isArray(value))return h('ul',{className:'sti-evidence-data'},...value.slice(0,5).map((v,i)=>h('li',{key:i},h(SelectionData,{value:v,depth:depth+1}))),value.length>5?h('li',null,'… ('+value.length+')'):null);
    return h('dl',{className:'sti-evidence-data'},...Object.entries(value).slice(0,16).map(([key,v])=>h('div',{key},h('dt',null,investFieldLabel(key)),h('dd',null,h(SelectionData,{value:v,depth:depth+1})))));
  }
  function SelectionEvidence({evidence,sources,t}) {
    const nearest=(ancestors,keys)=>{for(let i=ancestors.length-1;i>=0;i--){const value=ancestors[i];for(const key of keys)if(!Array.isArray(value)&&Object.hasOwn(value,key))return {found:true,value:value[key]};}return {found:false};};
    const date=value=>{if(value===null||value===undefined)return t('unknown');if(typeof value==='number'){const d=new Date(value+28800000);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):t('unknown');}return investText(value);};
    return h('details',{className:'sti-selection-evidence'},h('summary',null,t('evidence')+' · '+(evidence?.length || 0)),evidence?.length?h('div',null,...evidence.map((ref,i)=>{
      const src=(sources || []).find(x=>x.id===ref.source_id),fact=investEvidenceReference(src,ref.ref),ancestors=fact.ancestors;
      const year=nearest(ancestors,['fiscal_year']),period=nearest(ancestors,['fiscal_period','period']),end=nearest(ancestors,['period_end_ms','period_end']),disclosed=nearest(ancestors,['report_date_ms','report_date']),stamp=nearest(ancestors,['timestamp','fetched_at','as_of','created_at']);
      const kind=({quote:'quote',history:'history',trend:'structure',fundamentals:'financials',financials:'financials',valuation:'valuations',quant:'quant'})[src?.kind];
      const isQuant=src?.kind==='quant',fieldLabel=isQuant&&fact.field==='probability'?t('hitRate'):isQuant&&fact.field==='coverage'?t('coverage'):isQuant&&fact.field==='direction'?t('selectionDirection'):fact.field==='bias'?t('structure'):fact.field;
      const factValue=!fact.found?'':fact.value===null?t('selectionNullValue'):isQuant&&['probability','coverage'].includes(fact.field)&&typeof fact.value==='number'?pct(fact.value):isQuant&&fact.field==='direction'?t(fact.value===1?'up':fact.value===-1?'down':fact.value===0?'selectionDirectionNeutral':'unknown'):fact.field==='bias'&&['up','down','range'].includes(fact.value)?t(fact.value):investText(fact.value);
      return h('article',{key:ref.source_id+'|'+i},h('strong',null,investText(ref.source_id)),h('p',null,investText(ref.ref)),src?h(React.Fragment,null,
        h('p',{className:'sti-muted'},t('source')+': '+(kind?t(kind):investText(src.kind || src.id))+(src.source?' · '+investText(src.source):'')+' · '+(src.thscode || src.code || '')+' · '+t(src.available===true?'covered':'notAvailable')),
        fact.found?h('dl',{className:'sti-evidence-data'},h(Metric,{label:t('selectionFact')+' · '+fieldLabel,value:factValue}),
          year.found||period.found?h(Metric,{label:t('selectionFiscalPeriod'),value:(year.found?investText(year.value):'')+(period.found?' · '+investText(period.value):'')}):null,
          end.found?h(Metric,{label:t('selectionPeriodEnd'),value:date(end.value)}):null,
          disclosed.found?h(Metric,{label:t('selectionDisclosed'),value:date(disclosed.value)}):null):h('p',{className:'sti-warning'},t('selectionInvalidRef')),
        h('p',{className:'sti-muted'},t('selectionSourceTime')+': '+time(stamp.found?stamp.value:undefined)),
        isQuant?h('p',{className:'sti-muted'},t('disclaimer')):null,
        h('details',null,h('summary',null,t('selectionSupplement')),h(SelectionData,{value:src.data}))):h('p',{className:'sti-warning'},t('selectionEvidenceMissing')));
    })):h('p',{className:'sti-warning'},t('noEvidence')));
  }
  function SelectionPick({pick,sources,t}) {
    const again=pick.reselection;
    return h('article',{className:'sti-selection-pick'},h('h4',null,(pick.name || '')+' '+pick.code),h('div',{className:'sti-pick-view'},h('strong',null,t('reason')),h('p',null,investText(pick.reason)),pick.why_fit?h('p',null,t('selectionFit')+': '+investText(pick.why_fit)):null,
      again&&typeof again==='object'?h('div',{className:'sti-scope-note'},h('strong',null,t('portfolioReselection')),
        investFactorCount(again.times)?h('p',null,t('portfolioReselectionCount')+': '+num(again.times)):null,
        again.last_selected_at?h('p',null,t('portfolioReselectionPrevious')+': '+investOutputTime(again.last_selected_at)):null,
        again.reason?h('p',null,t('portfolioReselectionReason')+': '+investText(again.reason)):null):null,
      h('p',{className:'sti-muted'},t('confidence')+': '+t(({low:'confidenceLow',medium:'confidenceMedium',high:'confidenceHigh'})[pick.confidence] || 'unknown')),
      h('h4',null,t('risks')),pick.risks?.length?h(Warnings,{items:pick.risks}):h('p',{className:'sti-muted'},t('selectionNoRisks')),
      h('h4',null,t('selectionMissing')),pick.missing_evidence?.length?h(Warnings,{items:pick.missing_evidence}):h('p',{className:'sti-muted'},'—'),
      pick.quant_status?h('p',{className:'sti-muted'},t(({not_requested:'selectionQuantNotRequested',unavailable:'selectionQuantUnavailable',available:'selectionQuantAvailable'})[pick.quant_status] || 'unknown')):null,
      pick.quant_comment?h('p',{className:'sti-muted'},t('quant')+': '+investText(pick.quant_comment)):null,
      ),h('div',{className:'sti-pick-evidence'},h(SelectionEvidence,{evidence:pick.evidence,sources,t}),h(ReviewComparison,{items:pick.history_comparison,t}),h(StockActions,{item:pick,t})));
  }
  function SelectionResult({result,t,running=false,experts=[]}) {
    const expertResults=Array.isArray(result.expert_results)?result.expert_results:[];
    // Dark desk: expert index on the left and ONE expert's list at a time. Light file: every
    // expert's own dossier, in order. Lists are never merged into a single ranking in either view.
    const ui=useStore(),dark=ui.scheme==='dark',chosen=ui.selectionFocus,setChosen=index=>store.setSelectionFocus(index);
    const focus=Number.isInteger(chosen)&&chosen>=0&&chosen<expertResults.length?chosen:0;
    const expertName=row=>row.expert?.name || row.expert?.id || '—';
    const rail=dark&&expertResults.length?h('nav',{className:'sti-expert-rail','aria-label':t('selectionNames')},...expertResults.map((row,i)=>h('button',{key:row.expert?.id || i,type:'button',className:'sti-rail-item','aria-current':i===focus?'true':undefined,onClick:()=>setChosen(i)},h('span',null,expertName(row)),h('span',{className:'sti-rail-count','aria-label':t('selectionPicks')},num(row.picks?.length)),h('small',null,row.expert?.tag || '')))):null;
    const matrixCodes=dark?[...new Map(expertResults.flatMap(row=>(row.picks||[]).map(pick=>[pick.code,pick.name || ''])))]:[];
    const matrix=dark&&matrixCodes.length?h(Card,{title:t('selectionPicks'),className:'sti-matrix'},h(Table,{heads:[t('code'),...expertResults.map(expertName)],minWidth:420,rows:matrixCodes.map(([code,name])=>h('tr',{key:code},h('td',null,(name?name+' ':'')+code),...expertResults.map((row,i)=>{const hit=(row.picks||[]).some(pick=>pick.code===code);return h('td',{key:i,className:hit?'sti-hit':undefined},hit?'●':'—');})))})):null;
    const comparisons=(items,empty)=>items?.length?h('ul',{className:'sti-selection-comparison'},...items.map((item,i)=>h('li',{key:item.code+'|'+i},h('strong',null,(item.name || '')+' '+item.code),h('span',null,' · '+num(item.count)+' · '+(item.experts || []).map(e=>e.name || e.id).join(' / '))))):h(Empty,null,t(empty));
    return h('div',{className:'sti-selection-result'},h('p',{className:'sti-warning'},t('selectionOnlyResearch')),rail,
      result.universe?h(Card,{title:t('selectionUniverse')},h('dl',{className:'sti-metrics'},h(Metric,{label:t('selectionAllowedStocks'),value:num(result.universe.total)}),h(Metric,{label:t('source'),value:investText(result.universe.source)}),h(Metric,{label:t('reportTime'),value:time(result.universe.timestamp)}))):null,
      ...expertResults.map((row,i)=>dark&&i!==focus?null:h(Card,{key:row.expert?.id || i,title:(row.expert?.name || row.expert?.id || '—')+' · '+(row.expert?.tag || ''),className:'sti-selection-expert'},
        h('p',{className:'sti-muted'},t('selectionStyle')),h('h3',null,t('selectionApproach')),h('p',null,investText(row.selection_approach) || '—'),
        h('h3',null,t('selectionPicks')+' · '+row.picks.length),...row.picks.map((pick,n)=>h(SelectionPick,{key:pick.code+'|'+n,pick,sources:row.evidence_sources,t})),
        !row.picks.length?h(Empty,null,t(['queued','pending','running','cancelling'].includes(row.status)?'selectionResearching':'selectionNoPicks')):null,row.abstained_reason?h('p',{className:'sti-warning'},t('abstained')+': '+investText(row.abstained_reason)):null,
        row.rejected?.length?h('details',null,h('summary',null,t('selectionRejected')),h('ul',null,...row.rejected.map((r,n)=>h('li',{key:n},(r.code || '')+' · '+investText(r.reason))))):null,
        h('p',{className:'sti-muted'},t('selectionDirectorySeen')+': '+num(row.coverage?.directory_unique_items)+' '+t('selectionEntries')+' / '+t('selectionResearched')+': '+num(row.coverage?.researched_count)+' '+t('selectionStocks')),
        row.coverage?h('details',null,h('summary',null,t('selectionCoverage')),h(SelectionData,{value:row.coverage})):null,
        h('p',{className:'sti-muted'},t('source')+': '+investText(row.model)+' · '+t('reportTime')+': '+time(row.created_at)))),
      !expertResults.length?h(Empty,null,t(running?'selectionPending':'selectionNone')):null,
      matrix,h(Card,{title:t('selectionCommon')},h('p',{className:'sti-muted'},t('selectionCompareNote')),comparisons(result.common_picks,'selectionNoCommon')),
      h(Card,{title:t('selectionDifferences')},comparisons(result.differences,'selectionNoDifferences')),
      result.errors?.length?h(Card,{title:t('selectionErrors')},h('ul',{className:'sti-warnings'},...result.errors.map((e,i)=>h('li',{key:i},investText(e.expert?.name || e.expert?.id || e.expert)+' · '+investText(e.status)+' · '+investText(e.error))))):null,
      result.activity?.length?h(Card,{title:t('selectionActivity')},h('ol',{className:'sti-selection-activity'},...result.activity.slice(-40).map((a,i)=>h('li',{key:i},h('strong',null,experts.find(e=>e.id===a.expert_id)?.name || expertResults.find(e=>e.expert?.id===a.expert_id)?.expert?.name || a.expert_id || ''),h('span',null,' · '+investText(a.action)+' · '+investText(a.tool)),h('p',null,investText(a.message)),h('small',null,time(a.at)))))):null,
      h(Warnings,{items:result.warnings}));
  }
  function Screen({t,onOpenExpertSession}) {
    const s=useStore(),sa=s.selectionAi,r=s.screen,j=s.selectionJob,d=j.data,result=d?.result,active=j.submitting||j.cancelling||['queued','pending','running','cancelling'].includes(d?.status),p=j.params;
    const changed=p&&(p.scope!==r.scope||(p.sector || '')!==r.sector.trim().toUpperCase()||p.brief!==r.brief.trim()||p.expert_ids.join('|')!==s.selectionExpertIds.join('|'));
    React.useEffect(()=>{store.resumeSelectionPolling();return()=>store.stopSelectionPolling();},[]);
    React.useEffect(()=>{if(r.scope==='sector'&&s.sectors.phase==='idle')void store.loadSectors(0);},[r.scope,s.sectors.phase]);
    return h('div',null,h('div',{className:'sti-scope-note',role:'note'},h('strong',null,t('selectionIntro'))),
      h('div',{className:'sti-screen-grid'},h('aside',{className:'sti-screen-side'},h(Card,{title:t('screen')},h('p',{className:'sti-muted'},t('screenHelp')),
        h('div',{className:'sti-controls'},h('label',null,t('scope'),h('select',{value:r.scope,onChange:e=>store.screenOptions({scope:e.target.value,sector:e.target.value==='sector'?s.selectedSector?.thscode || '':''})},h('option',{value:'market'},t('market')),h('option',{value:'watchlist'},t('watchScope')),h('option',{value:'sector'},t('sectorScope'))))),
        r.scope==='watchlist'?h('p',{className:'sti-muted'},t('selectionWatchHint')):null,
        r.scope==='sector'?h('div',{className:'sti-controls'},
          h('label',null,t('sectorSearch'),h('input',{value:s.sectors.q,maxLength:60,onChange:e=>store.sectorOptions({q:e.target.value})})),
          h(Button,{onClick:()=>store.loadSectors(0),disabled:s.sectors.phase==='loading'},t('findSector')),
          h('label',null,t('selectionSector'),h('select',{value:r.sector,onChange:e=>store.screenOptions({sector:e.target.value})},
            h('option',{value:''},'—'),
            ...((s.sectors.data?.items)||[]).map(item=>h('option',{key:item.thscode,value:item.thscode},(item.name||item.thscode)+' '+item.thscode)))),
          s.sectors.phase==='error'?h(Status,{resource:s.sectors,t}):null,
          s.sectors.data&&!s.sectors.data.items?.length?h('p',{className:'sti-muted'},t('noSectors')):null,
          r.sector?h('p',{className:'sti-muted'},(s.selectedSector?.name || r.sector)+' · '+r.sector):h('p',{className:'sti-warning'},t('selectionMissingSector'))):null,
        h('label',null,t('selectionBrief'),h('textarea',{rows:3,maxLength:1000,value:r.brief,placeholder:t('selectionBriefHint'),onChange:e=>store.screenOptions({brief:e.target.value})})),
        h('small',null,Array.from(r.brief).length+' / 1000'),
        h('p',{className:'sti-muted'},t('selectionAllExperts')),
        h('p',{className:'sti-warning'},t('cost')),h(Button,{primary:true,disabled:sa.phase==='submitting'||r.scope==='sector'&&!r.sector||Array.from(r.brief.trim()).length>1000,onClick:()=>store.startSelectionAnalysis(onOpenExpertSession)},t(sa.phase==='submitting'?'submitting':'selectionStart')),
        sa.error?h('p',{className:'sti-error',role:'alert'},sa.error):null,
        sa.phase==='ready'&&sa.sessionId?h(Button,{onClick:()=>store.openSelectionAnalysisSession(onOpenExpertSession)},t('selectionOpenSession')):null),
      p?h(Card,{title:t('selectionParameters')},changed?h('p',{className:'sti-warning'},t('selectionChanged')):null,
        h('dl',{className:'sti-metrics'},h(Metric,{label:t('scope'),value:t(p.scope==='market'?'market':p.scope==='sector'?'sectorScope':'watchScope')+(p.sector?' · '+p.sectorName+' '+p.sector:'')}),h(Metric,{label:t('selectionNames'),value:p.experts.map(e=>e.name).join(' / ')}),h(Metric,{label:t('selectionBrief'),value:p.brief || t('selectionNoBrief')}),h(Metric,{label:t('selectionLimit'),value:5}))):null,
      d?h(Card,{title:t('job')+' · '+d.id},h('p',{role:'status'},t(d.status==='interrupted'?'jobInterrupted':d.status==='running'?'jobRunning':['completed','succeeded','done'].includes(d.status)?'jobCompleted':['failed','error'].includes(d.status)?'jobFailed':['cancelled','canceled'].includes(d.status)?'jobCancelled':'jobQueued')+' · '+t('progress')+': '+num(d.progress)+' / '+num(d.total)),
        active?h('p',{className:'sti-muted'},t('selectionPartial')):null,!active&&['completed','succeeded','done'].includes(d.status)&&result?.errors?.length?h('p',{className:'sti-warning'},t('selectionSomeFailed')):null,j.paused?h('p',{className:'sti-warning'},t('selectionPollPaused')):null,
        h('div',{className:'sti-actions'},active?h(Button,{disabled:j.cancelling,onClick:()=>store.cancelSelection()},t(j.cancelling?'cancelPending':'cancel')):null,
          active&&j.paused?h(Button,{disabled:j.cancelling,onClick:()=>store.resumeSelectionPolling(true)},t('continueCheck')):null),
        active?h('p',{className:'sti-muted'},t('selectionCancelWait')):null,d.error?h('p',{className:'sti-error',role:'alert'},investText(d.error)):null,h(Warnings,{items:d.errors})):null,
      ),h('div',{className:'sti-screen-main'},h(ErrorView,{error:j.error,t}),result?h(SelectionResult,{result,t,running:active,experts:p?.experts}):!active&&d?h(Empty,null,t('selectionNone')):!p?h(Empty,null,t('screenIdle')):null,
      h(ErrorView,{error:s.add.error,t}),s.add.phase==='ready'?h('p',{role:'status'},s.add.code+' · '+t('added')):null)));
  }
  function Candles({data,kind,t}) {let m;try {m=investHistory(data,kind);}catch{return h(Empty,null,t('chartEmpty'));}const left=12,right=816,top=22,bottom=228,volumeTop=268,volumeBottom=326,span=m.high-m.low || Math.max(1,m.high*.01),y=v=>bottom-(v-m.low)/span*(bottom-top),step=(right-left)/m.items.length,w=Math.max(1,Math.min(8,step*.65));const shapes=[];for(let i=0;i<5;i++){const v=m.low+span*i/4;shapes.push(h('line',{key:'g'+i,x1:left,x2:right,y1:y(v),y2:y(v),className:'sti-gridline'}),h('text',{key:'l'+i,x:right+7,y:y(v)+4,className:'sti-chart-label'},num(v)));}m.items.forEach((r,i)=>{const x=left+step*(i+.5),cls=r.close_price>=r.open_price?'sti-up':'sti-down';shapes.push(h('line',{key:'w'+i,x1:x,x2:x,y1:y(r.high_price),y2:y(r.low_price),className:cls}),h('rect',{key:'b'+i,x:x-w/2,y:Math.min(y(r.open_price),y(r.close_price)),width:w,height:Math.max(1,Math.abs(y(r.open_price)-y(r.close_price))),className:cls}));if(r.volume!==null&&m.volumeMax>0)shapes.push(h('rect',{key:'v'+i,x:x-w/2,y:volumeBottom-r.volume/m.volumeMax*(volumeBottom-volumeTop),width:w,height:r.volume/m.volumeMax*(volumeBottom-volumeTop),className:cls+' sti-volume'}));});shapes.push(h('text',{key:'vol-label',x:left,y:volumeTop-8,className:'sti-chart-label'},t('volume')));return h('figure',{className:'sti-chart'},h('svg',{viewBox:'0 0 900 345',role:'img','aria-label':t('history')+' · '+t(kind==='sector'?'unadjusted':'forward')},h('title',null,t('history')),...shapes),h('figcaption',null,h('span',null,day(m.first)+' — '+day(m.last)+' · '+m.items.length+' '+t('bars')+' · '+t(kind==='sector'?'unadjusted':'forward')),h('p',null,t('chartLegend'))));}
  function Source({value,t,children}) {return value?.available?children:h('p',{className:'sti-muted'},t('unavailable')+': '+investText(value?.error || '—'));}
  function Quant({value,t}) {return h(Card,{title:value?.legacy?t('quant')+' · legacy（旧网格，仅历史参考）':t('quant')},h('strong',{className:'sti-alignment'},t('agreement')+': '+t(value?.agreement || 'unavailable')),h('p',{className:'sti-muted'},t('cutoff')+': '+(value?.as_of || t('unknown'))),h('div',{className:'sti-signal-grid'},...[5,10,20].map(horizon=>{const item=value?.items?.find(x=>x.horizon===horizon),q=item?.result;return h('article',{className:'sti-signal',key:horizon},h('h3',null,horizon+' · '+t('cycle')),item?.available?h(React.Fragment,null,h('strong',null,t(q.direction===1?'up':q.direction===-1?'down':'neutral')),h('p',null,q.direction===0?t('signalZero'):t('hitRate')+': '+pct(q.probability)),h('p',null,t('samples')+': '+num(q.sample?.predictions)),h('p',null,t('coverage')+': '+pct(q.sample?.coverage)),h('small',null,t('source')+': '+investText(q.source)),h(Warnings,{items:q.warnings})):h('p',null,t('notCovered')+' '+investText(item?.error || '')));})),h('p',{className:'sti-muted'},t('allSignals')),h('p',{className:'sti-warning'},t('disclaimer')));}
  function PricePanel({report,price,t}) {
    const target=report.target,fund=['ETF','LOF'].includes(target.category),places=fund?3:2;
    const p=price?.target===target?price:null,data=p?p.data:report.quote?.data,row=investPriceRow(data,target);
    const last=cockpitNumber(row?.last_price),ratio=cockpitNumber(row?.price_change_ratio_pct),amount=cockpitNumber(row?.price_change);
    const times=investPriceTimes(row,data),session=investPriceSession(p?.asOf??Date.now(),times.day);
    const closed=['priceClosed','priceWeekend','priceNoToday'].includes(session.status);
    let label=t('priceLatest');
    if(closed){const day=times.day;label=day?t('priceDatedClose').replace('{m}',String(+day.slice(5,7))).replace('{d}',String(+day.slice(8))):t('priceClose');}
    const missing=p?.missing||report.quote?.error;
    const note=missing?(missing==='invalidResponse'?t('priceNoRow'):investText(missing)):t('priceAbsent');
    const absent='— '+note,signed=(v,n)=>v===null?absent:(v<0?'−':v>0?'+':'— ')+Math.abs(v).toFixed(n);
    return h('section',{className:'sti-card sti-quote-panel','aria-label':t('priceCurrent')},
      h('h2',null,t('priceCurrent')),h('p',{className:'sti-quote-label'},label),
      h('div',{className:'sti-quote-value'},last===null?'—':last.toFixed(places),last!==null?h('small',null,t('priceUnit')):null),
      last===null?h('p',{className:'sti-warning'},h('svg',{width:16,height:16,viewBox:'0 0 16 16',fill:'none',stroke:'currentColor','aria-hidden':'true'},h('circle',{cx:8,cy:8,r:6.3}),h('path',{d:'M8 4.5v4M8 10v1.5'})),note):null,
      h('p',{className:'sti-quote-change','data-trend':trendOf(ratio)},t('pricePct')+' '+(ratio===null?absent:signed(ratio,2)+'% '+t(ratio>0?'priceUp':ratio<0?'priceDown':'priceFlat'))+' · '+t('priceAmount')+' '+(amount===null?absent:signed(amount,places)+' '+t('priceUnit'))),
      h('dl',{className:'sti-quote-meta'},h(Metric,{label:t('priceState'),value:t(session.status)}),h(Metric,{label:t('priceMarketTime'),value:times.marketText??absent}),
        times.day?h(Metric,{label:t('priceDay'),value:times.day}):null,h(Metric,{label:t('priceResponseTime'),value:times.response===null?absent:investPriceClock(times.response)}),h(Metric,{label:t('source'),value:investText(data?.source)||absent})),
      p?.error?h('p',{className:'sti-quote-stale sti-warning',role:'status'},t('priceExpired')+' · '+(p.error.key==='requestFailed'?p.error.detail:t(p.error.key))):null);
  }
  function Brief({report,t,onAnalyze,actions=true,onOpenSession}) {
    const s=useStore(),q=report.quote?.data,tr=report.trend?.data,showEvidence=report.kind!=='stock',ai=s.stockAi;
    const quote=q?.items?.find(row=>report.kind==='sector' ? row.thscode===report.target.thscode || row.code===report.target.code : row.code===report.target.code);
    const fields=[['ma5',tr?.ma5],['ma20',tr?.ma20],['ma60',tr?.ma60],['return5',tr?.return_5d_pct,'%'],['return20',tr?.return_20d_pct,'%'],['lowReference',tr?.support_20d],['resistance',tr?.resistance_20d],['volumeRatio',tr?.volume_ratio]];
    const quoteCard=h(Card,{title:t('quote')},h(Source,{value:report.quote,t},quote ? h(React.Fragment,null,
      h('div',{className:'sti-price','data-trend':trendOf(quote.price_change_ratio_pct)},num(quote.last_price),h('small',null,signedPct(quote.price_change_ratio_pct))),
      h('p',{className:'sti-muted'},t('quoteTime')+': '+time(Object.hasOwn(quote,'timestamp')?quote.timestamp:q.timestamp)),
      h('p',{className:'sti-muted'},t('source')+': '+investText(q.source))) : h(Empty,null,t('unavailable'))));
    const structureCard=h(Card,{title:t('structure')},h(Source,{value:report.trend,t},
      h('strong',null,t(tr?.bias || 'unavailable')),
      h('dl',{className:'sti-metrics'},...fields.map(([label,v,suffix])=>h(Metric,{key:label,label:t(label),value:num(v,suffix)})))));
    const historyCard=h(Card,{title:t('history'),className:'sti-wide'},h(Source,{value:report.history,t},
      h(Candles,{data:report.history?.data,kind:report.kind,t}),
      h('p',{className:'sti-muted'},t('source')+': '+investText(report.history?.data?.source)+' · '+t('apiTime')+': '+time(report.history?.data?.timestamp))));
    const sectorCard=report.kind==='sector' ? h(Card,{title:t('breadth')},
      h(Source,{value:report.breadth,t},h('dl',{className:'sti-metrics'},
        h(Metric,{label:t('breadthSample'),value:num(report.breadth?.data?.sample_size)+' / '+num(report.breadth?.data?.total_constituents)}),
        ...['up','down','flat','missing'].map(key=>h(Metric,{key,label:t(key==='up'?'rising':key==='down'?'falling':key),value:num(report.breadth?.data?.[key])})))),
      h(Button,{onClick:()=>store.screenSector()},t('screenSector')),
      h('h3',null,t('constituents')),h('p',{className:'sti-sample-note'},t('sampleNote')),
      h(Source,{value:report.constituents,t},h('div',{className:'sti-constituents sti-sample-box'},
        ...(report.constituents?.data?.items || []).map((item,i)=>h(Button,{key:item.thscode || item.code+'|'+i,onClick:()=>store.openStock(item.code,item.name)},(item.name || '')+' '+item.code)))),
      h('p',{className:'sti-muted'},t('matched')+': '+num(report.constituents?.data?.total))) : null;
    const actionCard=actions ? h(Card,{title:t('teamNext')},h('p',{className:'sti-muted'},t('teamNextHelp')),
      h('div',{className:'sti-actions'},
        h(Button,{primary:true,disabled:ai?.phase==='submitting',onClick:()=>store.startStockAnalysis(onOpenSession)},t(ai?.phase==='submitting'?'stockAiRunning':'teamNext')),
        report.kind==='stock'?h(Button,{disabled:s.add.phase==='loading',onClick:()=>store.addWatch()},t('addWatch')):null,
        h(Button,{disabled:s.draft.phase==='loading',onClick:()=>store.draft(onAnalyze,t)},t('draft'))),
      ai?.error?h('p',{className:'sti-error',role:'alert'},ai.error):null,
      ai?.sessionId?h(Button,{onClick:()=>store.openStockAnalysisSession(onOpenSession)},t('stockAiOpen')):null,
      h('p',{className:'sti-muted'},t('draftHelp')),h(ErrorView,{error:s.add.error,t}),
      s.add.phase==='ready'?h('p',{role:'status'},t('added')):null,
      s.draft.phase==='ready'?h('p',{role:'status'},t('draftReady')):null,
      h(ErrorView,{error:s.draft.error,t}),s.draft.phase==='error'?h('label',null,t('copyDraft'),h('textarea',{readOnly:true,rows:8,value:s.draft.prompt,onFocus:e=>e.target.select()})):null) : null;
    return h('div',null,
      h('div',{className:'sti-target'},h('h2',null,(report.target.name || '')+' '+(report.target.thscode || report.target.code)),h('p',null,t('reportTime')+': '+time(report.created_at))),
      showEvidence?h('div',{className:'sti-evidence-grid'},quoteCard,structureCard,historyCard):h(PricePanel,{report,price:s.stockPrice,t}),showEvidence?h(Quant,{value:report.quant,t}):null,
      showEvidence?h('p',{className:'sti-muted'},t('snapshotNote')):null,
      showEvidence&&report.quant?.as_of&&q?.timestamp&&String(report.quant.as_of).slice(0,10)<day(q.timestamp)?h('p',{className:'sti-warning'},t('stale')):null,
      showEvidence?h(Card,{title:t('evidenceCoverage')},h('dl',{className:'sti-metrics'},...[
        ['quote','quote'],['history','history'],['quant','quant'],['fundamentals','financials'],['valuation','valuations'],['news','newsEvidence']
      ].map(([key,label])=>h(Metric,{key,label:t(label),value:key==='quant'?(report.quant?.items || []).filter(item=>item.available).length+' / 3':t(report[key]?.available?'covered':'notAvailable')})))):null,
      sectorCard,showEvidence?h(Warnings,{items:report.warnings}):null,actionCard);
  }
  function Stock({t,onAnalyze,onOpenExpertSession}) {
    const s=useStore();
    React.useEffect(()=>store.mountPrice(globalThis.document),[store]);
    const fundAsset=s.stockAsset==='基金';
    const items=(s.stockSearch.data?.items || []).filter(item=>fundAsset?['ETF','LOF'].includes(item.category):item.category===s.stockAsset);
    const lookup=category=>{const q=s.stockCode.trim();if(!q)return;const explicit=category==='基金'?undefined:category;if(/^\d{6}$/.test(q))void store.queryStock(q,undefined,explicit);else{store.setSearch(q);void store.searchStocks(category);}};
    return h('div',null,h(Card,{title:t('stock')},h('p',{className:'sti-muted'},t('briefHelp')),
      h('form',{className:'sti-controls',onSubmit:e=>{e.preventDefault();lookup('个股');}},
        h('label',null,t('stockLookup'),h('input',{value:s.stockCode,maxLength:60,placeholder:'中国神华 / 601088 / 513290',onChange:e=>{store.setCode(e.target.value);store.setSearch(e.target.value);}})),
        h(Button,{type:'submit',primary:true,disabled:!s.stockCode.trim()||s.report.phase==='loading'||s.stockSearch.phase==='loading'},t('findStock')),
        h(Button,{type:'button',disabled:!s.stockCode.trim()||s.report.phase==='loading'||s.stockSearch.phase==='loading',onClick:()=>lookup('基金')},t('findFund'))),
      h('p',{className:'sti-muted'},t('lookupHint')),h(Status,{resource:s.stockSearch,t}),
      s.stockSearch.data?h('p',{className:'sti-muted'},t('source')+': '+investText(s.stockSearch.data.source)):null,
      h('div',{className:'sti-constituents'},...items.map(item=>h(Button,{key:item.thscode,onClick:()=>store.queryStock(item.code,item.name,item.category)},(item.name || item.code)+' '+item.code))),
      s.stockSearch.phase==='ready'&&!items.length?h(Empty,null,t(fundAsset?'stockSearchEmptyFund':'stockSearchEmpty')):null),
      h(Status,{resource:s.report,t}),s.report.data?.kind==='stock'?h(Brief,{report:s.report.data,t,onAnalyze,onOpenSession:onOpenExpertSession}):h(Empty,null,t('emptyBrief')));
  }
  function Sectors({t,onAnalyze,onOpenExpertSession}) {
    const s=useStore(),r=s.sectors,a=s.sectorAi;
    React.useEffect(()=>{if(s.connection.ready&&r.phase==='idle')void store.loadSectors();},[s.connection.ready,r.tag]);
    const sector=s.target?.kind==='sector'?s.target:null;
    return h('div',null,
      h(Card,{title:t('sectors')},
        h('div',{className:'sti-style-options'},...['industry','cn_concept'].map(tag=>h(Button,{key:tag,'aria-pressed':r.tag===tag,onClick:()=>store.sectorOptions({tag})},t(tag==='industry'?'industry':'concept')))),
        h('form',{className:'sti-controls',onSubmit:e=>{e.preventDefault();void store.loadSectors(0);}},h('label',null,t('sectorSearch'),h('input',{value:r.q,onChange:e=>store.sectorOptions({q:e.target.value})})),h(Button,{type:'submit',primary:true,disabled:r.phase==='loading'},t('findSector'))),
        h(Status,{resource:r,t}),h('p',{className:'sti-muted'},t('chooseSector')),
        h('div',{className:'sti-sector-list'},...(r.data?.items || []).map(item=>h(Button,{key:item.thscode,'aria-pressed':s.selectedSector?.thscode===item.thscode,onClick:()=>store.selectSector(item)},h('strong',null,item.name),h('small',null,item.thscode)))),
        r.data&&!r.data.items.length?h(Empty,null,t('noSectors')):null,
        r.data?h('div',{className:'sti-actions'},h(Button,{disabled:r.offset===0,onClick:()=>store.loadSectors(Math.max(0,r.offset-30))},t('previous')),h('span',null,(r.offset+1)+' — '+Math.min(r.offset+30,r.data.total)+' / '+r.data.total),h(Button,{disabled:r.offset+30>=r.data.total,onClick:()=>store.loadSectors(r.offset+30)},t('next'))):null),
      sector?h(Card,{title:t('sectorAi')},
        h('div',{className:'sti-target'},h('strong',null,(sector.name||'')+' '+sector.code)),
        h('p',{className:'sti-muted'},t('sectorAiHelp')),
        h('p',{className:'sti-warning'},t('cost')),
        a.error?h('p',{className:'sti-error',role:'alert'},a.error):null,
        h('div',{className:'sti-actions'},
          h(Button,{primary:true,disabled:a.phase==='submitting',onClick:()=>store.startSectorAnalysis(onOpenExpertSession)},t(a.phase==='submitting'?'sectorAiRunning':'sectorAiStart')),
          a.sessionId?h(Button,{onClick:()=>store.openSectorAnalysisSession(onOpenExpertSession)},t('sectorAiOpen')):null),
        a.sessionId?h('p',{role:'status'},t(a.phase==='ready'?'sectorAiAccepted':'sectorAiSessionReady')):null
      ):null
    );
  }

  function Vote({vote,t}) {const outlook=vote.outlook || {};return h('article',{className:'sti-card sti-vote'},h('h3',null,vote.expert?.name || vote.expert?.id || '—',h('small',null,vote.expert?.tag || '')),h('strong',null,vote.abstained || !vote.evidence?.length?t('abstained'):t(vote.vote===1 || vote.vote==='up'?'up':vote.vote===-1 || vote.vote==='down'?'down':'neutral')),h('p',null,investText(vote.reason)),h('p',{className:'sti-muted'},t('confidence')+': '+t(({low:'confidenceLow',medium:'confidenceMedium',high:'confidenceHigh'})[vote.confidence] || 'unknown')),h('dl',{className:'sti-outlook'},...['short_term','medium_term','bull_case','bear_case','invalidation'].map((key,i)=>h(Metric,{key,label:t(['shortTerm','mediumTerm','bullCase','bearCase','invalidation'][i]),value:investText(outlook[key]) || '—'}))),h('h4',null,t('evidence')),vote.evidence?.length?h('ul',null,...vote.evidence.map((e,i)=>h('li',{key:i},investText(e.source)+' · '+investText(e.ref)))):h('p',{className:'sti-warning'},t('noEvidence')),h('h4',null,t('risks')),vote.risks?.length?h(Warnings,{items:vote.risks}):h('p',{className:'sti-muted'},t('noRisk')),h(ReviewComparison,{items:vote.history_comparison,t}));}
  function TeamResult({result,t}) {const c=result.consensus || {};return h('div',{className:'sti-team-result'},h(Card,{title:t('teamView')},h('h3',null,t('resultTarget')+': '+(result.target?.name || '')+' '+(result.target?.thscode || result.target?.code || '')),h('p',{className:'sti-muted'},t('reportTime')+': '+time(result.report?.created_at || result.created_at)),h('dl',{className:'sti-metrics'},h(Metric,{label:t('decision'),value:t(c.decision==='up'?'decisionUp':c.decision==='down'?'decisionDown':'decisionNone')}),h(Metric,{label:t('votesUp'),value:num(c.up)}),h(Metric,{label:t('votesDown'),value:num(c.down)}),h(Metric,{label:t('abstained'),value:num(c.abstained)}),h(Metric,{label:t('support'),value:pct(c.support)})),h('p',{className:'sti-warning'},t('voteNote')),h(Warnings,{items:result.errors})),...(result.votes || []).map((vote,i)=>h(Vote,{key:vote.expert?.id || i,vote,t})),result.report&&result.kind!=='sector'?h('details',{className:'sti-card'},h('summary',null,t('reportEvidence')),h(Quant,{value:result.report.quant,t}),h(Warnings,{items:result.report.warnings})):null);}
  function Experts({t,onOpenExpertSession}) {const s=useStore(),j=s.job,result=j.data?.result,running=['queued','pending','running','cancelling'].includes(j.data?.status),ai=s.target?.kind==='stock'?s.stockAi:s.target?.kind==='sector'?s.sectorAi:null,anyEnabled=(s.experts.data?.items||[]).some(e=>e.enabled!==false);const startAi=()=>{if(s.target?.kind==='stock')return store.startStockAnalysis(onOpenExpertSession);if(s.target?.kind==='sector')return store.startSectorAnalysis(onOpenExpertSession);return store.startTeam(true);};React.useEffect(()=>{if(s.connection.ready)void store.loadExperts();},[s.connection.ready]);React.useEffect(()=>{store.resumePolling();return()=>store.stopPolling();},[]);return h('div',null,h(Card,{title:t('experts')},h('p',null,t('teamIntro')),h('div',{className:'sti-target'},h('strong',null,t('currentTarget')+': '+(s.target?(s.target.name+' '+s.target.code):t('chooseTarget')))),h('div',{className:'sti-actions'},!s.target?h(Button,{onClick:()=>store.navigate('stock')},t('stock')):null,!s.target?h(Button,{onClick:()=>store.navigate('sectors')},t('sectors')):null,h(Button,{disabled:s.expertSaving||s.expertDelete.submitting||s.expertResearch.phase==='submitting',onClick:()=>store.newExpert()},t('expertNew'))),h(Status,{resource:s.experts,t}),s.expertCreating?h('form',{className:'sti-expert sti-expert-edit',onSubmit:event=>{event.preventDefault();void store.startExpertCreation(onOpenExpertSession);}},
        h('label',null,t('expertAiRequirement'),h('textarea',{rows:4,maxLength:8000,value:s.expertResearch.requirement,disabled:s.expertResearch.phase==='submitting',placeholder:t('expertAiExample'),onChange:event=>store.expertRequirement(event.target.value)})),
        h('p',{className:'sti-muted'},t('expertAiHelp')),h('p',{className:'sti-warning'},t('expertAiCost')),
        s.expertResearch.error?h('p',{className:'sti-error',role:'alert'},s.expertResearch.error):null,
        h('div',{className:'sti-actions'},h(Button,{type:'submit',primary:true,disabled:s.expertResearch.phase==='submitting'},t(s.expertResearch.phase==='submitting'?'submitting':'expertAiStart')),h(Button,{disabled:s.expertResearch.phase==='submitting',onClick:()=>store.cancelNewExpert()},t('expertCancel')))):
        s.expertResearch.data?.sessionId?h('div',{className:'sti-scope-note'},h('p',{role:'status'},t(s.expertResearch.data.submitted?'expertAiAccepted':'expertAiSessionReady')),s.expertResearch.error?h('p',{className:'sti-error',role:'alert'},s.expertResearch.error):null,h('div',{className:'sti-actions'},h(Button,{onClick:()=>store.openExpertCreationSession(onOpenExpertSession)},t('expertAiOpen')),h(Button,{onClick:()=>store.loadExperts()},t('refresh')))):null,h('h3',null,t('selectExperts')),h('div',{className:'sti-expert-grid'},...(s.experts.data?.items || []).map(e=>s.expertEdit===e.id
        ? h('div',{key:e.id,className:'sti-expert sti-expert-edit'},
            h('label',null,t('expertName'),h('input',{value:s.expertDraft?.name||'',onChange:ev=>store.updateExpertDraft({name:ev.target.value})})),
            h('label',null,t('expertTag'),h('input',{value:s.expertDraft?.tag||'',onChange:ev=>store.updateExpertDraft({tag:ev.target.value})})),
            h('label',null,t('expertCriteria'),h('textarea',{rows:4,value:s.expertDraft?.criteria||'',onChange:ev=>store.updateExpertDraft({criteria:ev.target.value})})),
            h('label',null,t('expertSystemPrompt'),h('textarea',{rows:12,value:s.expertDraft?.system_prompt||'',onChange:ev=>store.updateExpertDraft({system_prompt:ev.target.value})})),
            s.expertError?h('p',{className:'sti-error',role:'alert'},investText(s.expertError)):null,
            h('div',{className:'sti-actions'},h(Button,{primary:true,disabled:s.expertSaving,onClick:()=>store.saveExpert()},t(s.expertSaving?'submitting':'expertSave')),h(Button,{disabled:s.expertSaving,onClick:()=>store.cancelExpertEdit()},t('expertCancel')))
          )
        : h('div',{key:e.id,className:'sti-expert'},
            h('div',{className:'sti-expert-body'},
              h('label',null,h('input',{type:'checkbox',checked:s.expertIds.includes(e.id),disabled:e.enabled===false||running||j.submitting,onChange:()=>store.toggleExpert(e.id)}),h('strong',null,e.name)),
              h('p',{className:'sti-muted'},t('expertTraits')+'：'+investText(e.tag)),
              h('p',{className:'sti-muted'},t('criteria')+'：'+(Array.isArray(e.criteria)?e.criteria.join('、'):investText(e.criteria))),
              h('p',{className:'sti-muted'},t('expertMethod')),h('div',{className:'sti-prompt',style:{whiteSpace:'pre-wrap',maxHeight:'160px',overflow:'auto'}},e.system_prompt),
              h('p',{className:'sti-muted'},t('expertModel')+': '+(e.model||'—')+' · '+t('expertTools')+': '+(Array.isArray(e.tools)?e.tools.join('、'):investText(e.tools))),
              e.enabled===false?h('small',null,t('disabledExpert')):null
            ),
            h('div',{className:'sti-expert-footer'},
              h('div',{className:'sti-actions'},h(Button,{disabled:s.expertSaving||s.expertDelete.submitting,onClick:()=>store.editExpert(e.id)},t('expertEdit')),h(Button,{danger:true,disabled:s.expertSaving||s.expertDelete.submitting||s.expertResearch.phase==='submitting',onClick:()=>store.requestExpertDelete(e.id)},t('expertDelete'))),
              s.expertDelete.id===e.id?h('div',{className:'sti-expert-delete-confirm',role:'group','aria-label':t('expertDeleteQuestion')+' '+e.name,'aria-live':'polite'},
                h('p',null,t('expertDeleteQuestion'),' ',h('strong',null,s.expertDelete.name)),h('p',{className:'sti-muted'},t('expertDeleteNote')),
                s.expertDelete.error?h('p',{className:'sti-error',role:'alert'},s.expertDelete.error):null,
                h('div',{className:'sti-actions'},h(Button,{danger:true,disabled:s.expertDelete.submitting,onClick:()=>store.confirmExpertDelete()},t(s.expertDelete.submitting?'expertDeleting':'expertDeleteConfirm')),h(Button,{autoFocus:true,disabled:s.expertDelete.submitting,onClick:()=>store.cancelExpertDelete()},t('expertCancel')))):null
            )
          )
      )),
s.experts.phase==='ready'&&!s.experts.data.items.length?h(Empty,null,t('noExperts')):null,h('p',{className:'sti-warning'},t('cost')),h(Button,{primary:true,disabled:!s.target||!anyEnabled||ai?.phase==='submitting'||running||j.submitting,onClick:startAi},t(ai?.phase==='submitting'?'stockAiRunning':s.target?.kind==='stock'?'stockAiStart':s.target?.kind==='sector'?'sectorAiStart':'startTeam')),s.target?h('p',{className:'sti-muted'},t(s.target.kind==='stock'?'stockAiHelp':'sectorAiHelp')):null,ai?.error?h('p',{className:'sti-error',role:'alert'},ai.error):null,ai?.sessionId?h('div',{className:'sti-actions'},h(Button,{onClick:()=>s.target.kind==='stock'?store.openStockAnalysisSession(onOpenExpertSession):store.openSectorAnalysisSession(onOpenExpertSession)},t('stockAiOpen'))):null),
      j.data?h(Card,{title:t('job')+' · '+j.data.id},j.target&&investTargetKey(j.target)!==investTargetKey(s.target)?h('p',{className:'sti-warning'},t('jobOther')):null,h('strong',null,(j.target?.name || '')+' '+j.target?.code),h('p',{role:'status'},t(j.data.status==='interrupted'?'jobInterrupted':j.data.status==='running'?'jobRunning':['completed','succeeded','done'].includes(j.data.status)?'jobCompleted':['failed','error'].includes(j.data.status)?'jobFailed':['cancelled','canceled'].includes(j.data.status)?'jobCancelled':'jobQueued')+' · '+t('progress')+': '+num(j.data.progress)+' / '+num(j.data.total)),running?h('p',{className:'sti-muted'},t('submitted')):null,j.paused?h('p',{className:'sti-warning'},t('pollPaused')):null,h('div',{className:'sti-actions'},running?h(Button,{disabled:j.cancelling,onClick:()=>store.cancelJob()},t(j.cancelling?'cancelPending':'cancel')):null,running&&j.paused?h(Button,{onClick:()=>store.resumePolling(true)},t('continueCheck')):null),running?h('p',{className:'sti-muted'},t('cancelHelp')):null,h(Warnings,{items:j.data.errors}),j.data.error?h('p',{className:'sti-error',role:'alert'},investText(j.data.error)):null):null,h(ErrorView,{error:j.error,t}),result?h(TeamResult,{result,t}):null);}
  function FactorCurve({items,t}) {
    const rows=items || [],valid=rows.filter(row=>cockpitNumber(row.accuracy)!==null);
    if(!valid.length)return h(Empty,null,t('factorChartEmpty'));
    const left=48,bottom=210,top=20,step=38,y=value=>bottom-value*(bottom-top);
    return h('figure',{className:'sti-factor-chart'},h('svg',{viewBox:'0 0 850 258',role:'img','aria-label':t('factorCurve')},h('title',null,t('factorCurve')),
      ...[0,.5,1].map(value=>h('g',{key:'axis'+value},h('line',{className:'sti-gridline',x1:left,x2:820,y1:y(value),y2:y(value)}),h('text',{className:'sti-chart-label',x:5,y:y(value)+4},pct(value)))),
      ...rows.map(row=>h('g',{key:row.h},row.accuracy===null?null:h('g',null,h('title',null,'h='+row.h+' · '+pct(row.accuracy)+' · '+t('factorEvaluated')+': '+num(row.evaluated)),h('rect',{className:'sti-factor-bar',x:left+(row.h-1)*step+7,y:y(row.accuracy),width:24,height:Math.max(0,bottom-y(row.accuracy))}),h('circle',{className:'sti-factor-point',cx:left+(row.h-1)*step+19,cy:y(row.accuracy),r:2.5})),h('text',{className:'sti-chart-label',x:left+(row.h-1)*step+19,y:232,textAnchor:'middle'},row.h)))),
      h('figcaption',null,t('factorChartNote')));
  }
  function FactorMetrics({data,t}) {
    const m=data.metrics;
    return h(Card,{title:t('factorAccuracy')},h('div',{className:'sti-factor-hero'},h('strong',{className:'sti-factor-accuracy','data-accuracy':m.accuracy===null?'null':String(m.accuracy)},m.accuracy===null?'—':pct(m.accuracy)),h('span',{className:'sti-factor-direction','data-direction':data.direction},t(data.direction===1?'up':data.direction===-1?'down':'factorNeutral'))),
      m.accuracy===null?h('p',{className:'sti-muted'},t('factorNoAccuracy')):null,
      h('dl',{className:'sti-metrics'},...[
        ['factorCoverage',pct(m.coverage)],['factorEvaluated',num(m.evaluated)],['factorCorrect',num(m.correct)],['factorSkipped',num(m.skipped)],['factorNotEvaluated',num(m.not_evaluated)],['factorBaseline',pct(m.baseline.always_up)],['factorSameSet',pct(m.baseline.same_set)],['factorRule',data.rule.name+' · '+data.rule.id],['factorDataDate',data.as_of || t('unknown')],['factorBars',num(data.bars)]
      ].map(([label,value])=>h(Metric,{key:label,label:t(label),value}))),h('p',{className:'sti-warning'},t('factorDisclaimer')));
  }
  function FactorSamples({data,t}) {
    return h(Card,{title:t('factorBacktest')},h('p',{className:'sti-warning'},t('factorDisclaimer')),
      h('h3',null,t('factorConfusion')),h(Table,{heads:[t('factorPredicted'),t('factorActualUp'),t('factorActualDown'),t('factorActualFlat')],rows:['up','down'].map(direction=>h('tr',{key:direction},h('th',{scope:'row'},t(direction)),...['up','down','flat'].map(actual=>h('td',{key:actual},num(data.metrics.confusion[direction][actual])))))}),
      ...['false_positive','false_negative'].map(key=>h('section',{key},h('h3',null,t(key==='false_positive'?'factorFalsePositive':'factorFalseNegative')),
        !data.samples?h(Empty,null,t('factorSamplesMissing')):data.samples[key].length?h(Table,{heads:[t('factorSampleDate'),t('factorHorizon'),t('factorReturn')],rows:data.samples[key].map((row,i)=>h('tr',{key:row.date+'|'+row.h+'|'+i},h('td',null,row.date),h('td',null,row.h),h('td',null,pct(row.ret))))}):h(Empty,null,t('factorSamplesEmpty')))));
  }
  function FactorRules({rows,t,selected=''}) {
    return rows?.length?h(Table,{heads:[t('factorRuleId'),t('factorRule'),t('factorRuleAccuracy'),''],rows:rows.map(row=>h('tr',{key:row.id},h('td',null,row.id),h('td',null,row.name),h('td',null,pct(row.accuracy)),h('td',null,h(Button,{'aria-pressed':selected===row.id,onClick:()=>store.selectFactorRule(row.id,true)},t('factorShowRule')))))}):h(Empty,null,t('factorRulesEmpty'));
  }
  function FactorTranscript({t}) {
    const s=useStore(),output=s.factorTranscript,job=s.factorResearchJob.data,ref=React.useRef(null),isTerminal=job&&['completed','succeeded','done','failed','error','cancelled','canceled','interrupted'].includes(job.status),groups=investFactorOutputGroups(output.items);
    React.useEffect(()=>{if(output.following&&ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[output.jobId,output.seq,output.following,output.finalRead,job?.status,job?.result?.live_output]);
    const rawText=value=>investText(value,Math.max(1800,(value||'').length+100));
    const reason=job?.error||job?.result?.phase?.name==='budget_exhausted'&&(job.result.warnings?.join('\n')||'预算已耗尽')||t(job?.status==='interrupted'?'jobInterrupted':['cancelled','canceled'].includes(job?.status)?'jobCancelled':['failed','error'].includes(job?.status)?'jobFailed':'jobCompleted');
    return h('section',{className:'sti-factor-live','aria-label':t('factorLiveOutput')},h('div',{className:'sti-factor-live-heading'},h('h3',null,t('factorLiveOutput')),!output.following?h(Button,{onClick:()=>store.factorTranscriptFollowing(true)},t('factorOutputLatest')):null),h('p',{className:'sti-muted'},t('factorOutputNote')),
      h('div',{className:'sti-factor-live-scroll',ref,tabIndex:0,onScroll:e=>{const el=e.currentTarget;store.factorTranscriptFollowing(el.scrollHeight-el.scrollTop-el.clientHeight<=40);}},
        ...groups.map(item=>h('article',{key:item.seq,className:'sti-factor-output sti-factor-output-'+item.kind,'data-output-kind':item.kind},item.kind==='thinking'?h('details',null,h('summary',null,t('factorOutputThinking')+' · '+rawText(item.text).slice(0,140)),h('div',null,rawText(item.text))):item.kind==='tool'?h(React.Fragment,null,h('span',{className:'sti-factor-tool-chip'},t('factorOutputTool')+' · '+(item.tool||'—')),h('div',null,rawText(item.text))):h('div',null,rawText(item.text)),h('small',null,investOutputTime(item.at)))),
        !groups.length?job?.result?.live_output?h('article',{className:'sti-factor-output sti-factor-output-status'},h('small',null,t('factorOutputSummary')),rawText(job.result.live_output)):h('p',{className:'sti-muted'},t('factorOutputWaiting')):null,
        isTerminal?h('p',{className:['failed','error'].includes(job.status)?'sti-error sti-factor-output-end':'sti-muted sti-factor-output-end'},t('factorOutputEnded')+': '+rawText(String(reason))):null),
      h(ErrorView,{error:output.error,t}),output.error?h(Button,{onClick:()=>store.retryFactorTranscript()},t('factorOutputRetry')):null);
  }
  function FactorOrigin({rule,source,t}) {return h('small',null,t(source==='llm_batch'&&rule?.kind==='code'?'factorSourceLLM':source==='code_ad_hoc'&&rule?.kind==='code'?'factorSourceAdHoc':source==='seed_reference'||rule?.kind==='seed'?'factorSourceSeed':'factorSourceUnknown'));}
  function FactorBatch({t}) {
    const s=useStore(),p=s.factorResearch,j=s.factorResearchJob,d=j.data,r=d?.result,u=s.factorUniverse,active=store.activeFactorResearch(),out=s.factorResults,phase=r?.phase,c=r?.counters;
    const trialDone=r?.counters?.trials_completed??d?.progress??0;
    const shownErrors=(r?.errors||[]).filter(e=>e?.status!=='skipped'&&!String(e?.error||'').includes('数据不足'));
    const phaseKey=({planning:'研究候选量化因子',writing:'编写候选量化因子',generating:'生成候选量化因子',evaluating:'分片评测候选量化因子',evaluation:'分片评测候选量化因子',completed:'研究已停止',done:'研究已停止',queued:'等待研究',failed:'研究失败',cancelled:'已取消',interrupted:'已中断',budget_exhausted:'预算已耗尽，研究停止（已验证成果保留）',final_validating:'自动全量验证中（不调用模型）'})[phase?.name];
    return h('div',{className:'sti-factor-batch'},h('p',{className:'sti-scope-note'},t('factorBatchIntro')),h('p',{className:'sti-muted'},t('factorBatchCapacity')),
      h(Card,{title:t('factorDirectory')},h('strong',null,t('factorAll')),h(Status,{resource:u,t}),u.data?h('dl',{className:'sti-metrics'},h(Metric,{label:t('factorDirectory'),value:num(u.data.total)}),...u.data.categories.map(row=>h(Metric,{key:row.category,label:row.category,value:num(row.count)}))):h('p',{className:'sti-muted'},t('factorDirectoryEmpty')),h(Button,{disabled:u.phase==='loading',onClick:()=>store.loadFactorUniverse()},t('refresh'))),
      h(Card,{title:t('factorBatch')},h('label',null,t('factorBrief'),h('textarea',{rows:3,maxLength:1000,value:p.brief,onChange:e=>store.factorResearchOptions({brief:e.target.value})})),
        h('div',{className:'sti-controls'},h('label',null,t('factorWorkers'),h('select',{value:p.workers,onChange:e=>store.factorResearchOptions({workers:Number(e.target.value)})},...[2,4,8].map(n=>h('option',{key:n,value:n},n))))),
        h('details',{className:'sti-factor-budget',open:investMessages.budgetOpen!==false,onToggle:e=>{investMessages.budgetOpen=e.currentTarget.open;}},h('summary',null,t('factorBudget')),h('div',{className:'sti-controls'},...[['max_trials','factorTrials']].map(([key,label])=>h('label',{key},t(label),h('input',{type:'number',min:1,step:1,value:p[key],onChange:e=>store.factorResearchOptions({[key]:Number(e.target.value)})}))))),h('p',{className:'sti-muted'},t('factorBudgetHint')),
        h('p',{className:'sti-warning'},t('factorCost')),h('p',{className:'sti-muted'},t('factorFinalValidationNote')),h(Button,{primary:true,disabled:active||s.factorHistory.phase==='loading'||u.phase!=='ready'||!u.data?.total,onClick:()=>store.startFactorResearch(true)},t(j.submitting?'submitting':'factorStart'))),
      h('p',{className:'sti-muted'},t('factorRestoreNote')),!d?h(Button,{disabled:s.factorHistory.phase==='loading'||j.submitting,onClick:()=>store.restoreFactorResearch()},t('factorRestore')):null,h(Status,{resource:s.factorHistory,t}),s.factorHistory.data?.found===false?h('p',{className:'sti-muted'},t('factorNoHistory')):null,
      d?h(Card,{title:t('job')+' · '+d.id},h('p',{role:'status'},t(d.status==='interrupted'?'jobInterrupted':d.status==='running'?'jobRunning':['completed','succeeded','done'].includes(d.status)?'jobCompleted':['failed','error'].includes(d.status)?'jobFailed':['cancelled','canceled'].includes(d.status)?'jobCancelled':'jobQueued')),
        r?h('p',{className:r.scope==='targets'?'sti-warning':'sti-muted'},r.scope==='targets'?t('factorTaskSubset')+' '+num(r.scope_total)+' / '+t('factorTaskLocalTotal')+' '+num(r.universe.total):t('factorTaskAll')+' '+num(r.universe.total)):null,r?.scope==='targets'?h('p',{className:'sti-muted'},t('factorTaskScopeNote')):null,
        h('p',{className:'sti-muted'},t('factorJobProgress')+': '+num(d.progress)+' / '+num(d.total)),h('p',{className:'sti-warning'},t('factorPartial')),
        phase?h(React.Fragment,null,h('h3',null,t('factorBatchPhase')+' · '+(phaseKey||investText(phase.name))),h('p',null,(phase.rule_name||phase.rule_id||t('factorPhaseUnknown'))),h('p',{role:'status'},t('factorTrialProgress')+': '+num(trialDone)+' / '+num(d.total)),h('progress',{max:d.total||1,value:trialDone,'aria-label':t('factorTrialProgress')})):null,
        c?h('dl',{className:'sti-metrics'},...[['targets_evaluated','factorProcessed'],['targets_failed','factorFailed'],['targets_skipped','factorInsufficient'],['best_updates','factorImproved'],['rules_written','factorRulesWritten'],['trials_completed','factorTrialsDone'],['model_calls','factorModelCalls']].map(([key,label])=>h(Metric,{key,label:t(label),value:num(c[key])}))):null,r?.final_validation?h('p',{className:'sti-muted'},t('factorFinalValidation')+' · '+investText(r.final_validation.rule_name||r.final_validation.rule_id||'—')+' · '+num(r.final_validation.completed)+'/'+num(r.final_validation.total)+(r.final_validation.skipped?(' · '+t('factorInsufficient')+' '+num(r.final_validation.skipped)):'')+(r.final_validation.pooled_accuracy!=null?(' · '+pct(r.final_validation.pooled_accuracy)):'')+(r.final_validation.error?(' · '+investText(r.final_validation.error)):'')):null,h(FactorTranscript,{t}),
        h('div',{className:'sti-actions'},active?h(Button,{disabled:j.cancelling,onClick:()=>store.cancelFactorResearch()},t(j.cancelling?'cancelPending':'cancel')):null),d.error?h('p',{className:'sti-error'},investText(d.error)):null):null,
      h(ErrorView,{error:j.error,t}),r?.activity?.length?h(Card,{title:t('factorActivity')},h('ol',{className:'sti-selection-activity'},...r.activity.slice(-20).map((a,i)=>h('li',{key:i},typeof a==='string'?investText(a):h(React.Fragment,null,h('strong',null,investFactorAction(a.action||a.name)),a.message?h('p',null,investText(a.message)):null,h('small',null,investOutputTime(a.at))))))):null,
      shownErrors.length?h(Card,{title:t('factorErrors')},h(Warnings,{items:shownErrors})):null,h(Warnings,{items:r?.warnings}),
      d?h(Card,{title:t('factorResults')},h('p',{className:'sti-muted'},t('factorResultsNote')),h('form',{className:'sti-controls',onSubmit:e=>{e.preventDefault();void store.loadFactorResults(0);}},h('label',null,t('factorResultQuery'),h('input',{value:out.q,maxLength:60,onChange:e=>store.factorResultsQuery(e.target.value)})),h(Button,{type:'submit',disabled:out.phase==='loading'},t('factorQuery'))),h(Status,{resource:out,t}),
        out.data?.items.length?h(Table,{heads:[t('factorCategory'),t('code'),t('factorRule'),t('factorAccuracy'),t('factorCoverage'),t('factorDirection'),t('factorDataDate'),''],rows:out.data.items.map(row=>h('tr',{key:row.target_id},h('td',null,row.category),h('td',null,row.name,h('small',null,row.code)),h('td',null,row.rule_name===null?t('factorPendingResult'):row.rule_name,h('small',null,row.rule_id===null?'—':row.rule_id),h('small',null,t('factorResultStatus')+': '+t(['failed','error'].includes(row.status)?'factorFailedResult':['insufficient','insufficient_data','skipped'].includes(row.status)?'factorInsufficientResult':row.status==='completed'?'factorCompletedResult':row.rule_id!==null?'factorVerifiedResult':'factorPendingResult')+' · '+investText(row.status))),h('td',null,pct(row.accuracy)),h('td',null,pct(row.coverage)),h('td',null,row.direction===null?'—':t(row.direction===1?'up':row.direction===-1?'down':'factorNeutral')),h('td',null,row.as_of===null?'—':row.as_of),h('td',null,h(Button,{disabled:!row.rule_id,onClick:()=>store.openFactorResult(row)},t('factorQueryRule')))))}):out.phase==='ready'?h(Empty,null,t('factorNoResults')):null,
        out.data?h('div',{className:'sti-actions'},h(Button,{disabled:out.offset===0||out.phase==='loading',onClick:()=>store.loadFactorResults(Math.max(0,out.offset-50))},t('previous')),h('span',null,(out.data.total?out.offset+1:0)+' — '+Math.min(out.offset+50,out.data.total)+' / '+out.data.total),h(Button,{disabled:out.offset+50>=out.data.total||out.phase==='loading',onClick:()=>store.loadFactorResults(out.offset+50)},t('next'))):null):null);
  }
  function Factors({t}) {
    const s=useStore(),f=s.factors,current=f.backtest,data=current.data;
    React.useEffect(()=>{if(s.connection.ready)void store.ensureFactors();},[s.connection.ready]);
    React.useEffect(()=>()=>store.stopFactors(),[]);
    const label=tab=>tab==='batch'?'factorBatch':tab==='rules'?'factorLibrary':'factorBacktest';
    return h('div',{className:'sti-factors'},h('p',{className:'sti-scope-note'},t('factorIntro')),
      h('div',{className:'sti-factor-tabs',role:'tablist','aria-label':t('factors')},...['batch','rules','backtest'].map(tab=>h(Button,{key:tab,role:'tab','aria-selected':f.tab===tab,'aria-controls':'sti-factor-panel',onClick:()=>store.factorTab(tab)},t(label(tab))))),
      h('section',{id:'sti-factor-panel',role:'tabpanel','aria-label':t(label(f.tab))},f.tab==='batch'?h(FactorBatch,{t}):h(React.Fragment,null,
        f.tab==='backtest'?h(Card,{title:t('factorBacktestPick')},h('form',{className:'sti-controls',onSubmit:e=>{e.preventDefault();if(f.ruleId&&/^\d{6}$/.test(f.code))void store.selectFactorRule(f.ruleId,true);}},
          h('label',null,t('factorCategory'),h('select',{value:f.category,onChange:e=>store.factorInput({category:e.target.value})},...['个股','ETF','指数'].map(category=>h('option',{key:category,value:category},category)))),
          h('label',null,t('factorCode'),h('input',{inputMode:'numeric',maxLength:6,value:f.code,onChange:e=>store.factorInput({code:e.target.value})})),
          h(Button,{primary:true,type:'submit',disabled:!f.ruleId||current.phase==='loading'||!/^\d{6}$/.test(f.code)},t('factorQueryRule'))),f.ruleId?h('p',{className:'sti-muted'},t('factorRuleId')+': '+f.ruleId):h('p',{className:'sti-muted'},t('factorNoRuleSelected'))):null,
        f.tab==='rules'?h(Card,{title:t('factorLibrary')},h('p',{className:'sti-muted'},t('factorRuleOnly')),h(Button,{onClick:()=>store.loadFactorRules(),disabled:f.rules.phase==='loading'},t('refresh')),h(Status,{resource:f.rules,t}),f.rules.data?.items?.length?h(React.Fragment,null,h('p',{className:'sti-muted'},t('factorRulesTotal')+': '+num(f.rules.data.total)),h(Table,{heads:[t('factorRule'),t('factorAvgAccuracy'),t('factorHistCoverage'),t('factorRuleCreated')],rows:f.rules.data.items.map(row=>h('tr',{key:row.id},h('td',null,row.name,h('small',null,row.id),row.summary?h('p',{className:'sti-muted'},row.summary):h('p',{className:'sti-warning'},t('factorRuleSummaryMissing'))),h('td',null,row.accuracy==null?t('factorEliminated'):pct(row.accuracy)),h('td',null,row.coverage==null?t('factorEliminated'):pct(row.coverage)),h('td',null,row.created_at?investOutputTime(row.created_at):'—')))})):f.rules.phase==='ready'?h(Empty,null,t('factorRulesEmpty')):null):null,
        f.tab!=='rules'?h(Status,{resource:current,t}):null,f.tab!=='rules'&&data?h(React.Fragment,null,h(FactorOrigin,{rule:data.rule,source:data.source,t}),h(FactorMetrics,{data,t}),h(Card,{title:t('factorCurve')},h(FactorCurve,{items:data.metrics.per_horizon,t})),h(FactorSamples,{data,t}),h(Warnings,{items:data.warnings})):null,
        f.tab!=='rules'&&!data&&current.phase==='idle'?h(Empty,null,t(f.tab==='backtest'?'factorNoBacktest':'factorNoReport')):null)));
  }
  function Watchlist({t,onOpenExpertSession}) {
    const s=useStore();
    const rows=(s.watch.data?.items)||[],deselected=new Set(s.watchDeselected||[]),selected=rows.filter(item=>!deselected.has(item.code+'|'+item.category));
    React.useEffect(()=>{if(s.connection.ready&&s.watch.phase==='idle')void store.loadWatch();},[s.connection.ready,s.watch.phase]);
    const w=s.watchSearch,fundAsset=w.asset==='基金',items=((w.data?.items)||[]).filter(item=>fundAsset?['ETF','LOF'].includes(item.category):item.category===w.asset);
    const known=new Set(((s.watch.data?.items)||[]).map(item=>item.code+'|'+item.category));
    const [filter,setFilter]=React.useState(''),needle=filter.trim().toLowerCase(),shown=needle?rows.filter(item=>String(item.name||'').toLowerCase().includes(needle)||String(item.code||'').toLowerCase().includes(needle)):rows;
    const quotes=s.watchQuotes.items||{},listKey=rows.map(item=>item.code).join(','),quoteTime=s.watchQuotes.time?time(s.watchQuotes.time):'';
    React.useEffect(()=>{if(s.connection.ready&&s.watch.phase==='ready'&&rows.length&&s.watchQuotes.phase!=='loading'&&s.watchQuotes.key!==listKey)void store.loadWatchQuotes(rows,listKey);},[s.connection.ready,s.watch.phase,listKey,s.watchQuotes.phase]);
    const lookup=category=>{const q=(w.q||'').trim();if(!q)return;void store.searchWatch(category);};
    return h('div',null,
      h(Card,{title:t('watchAddTitle')},
        h('form',{className:'sti-controls',onSubmit:event=>{event.preventDefault();lookup('个股');}},
          h('label',null,t('watchAddLabel'),h('input',{value:w.q||'',maxLength:60,placeholder:'中国神华 / 601088 / 513290',onChange:event=>store.setWatchQuery(event.target.value)})),
          h(Button,{type:'submit',primary:true,disabled:!((w.q||'').trim())||w.phase==='loading'},t('findStock')),
          h(Button,{type:'button',disabled:!((w.q||'').trim())||w.phase==='loading',onClick:()=>lookup('基金')},t('findFund'))),
        h('p',{className:'sti-muted'},t('watchAddHint')),
        h(Status,{resource:w,t}),
        h('div',{className:'sti-constituents'},...items.map(item=>{
          const key=item.code+'|'+item.category,added=known.has(key);
          return h(Button,{key,disabled:added||s.add.phase==='loading',onClick:()=>store.addWatch(item.code,item.category)},
            (item.name||item.code)+' '+item.code+(added?' · '+t('watchInList'):''));
        })),
        w.phase==='ready'&&!items.length?h(Empty,null,t(w.asset==='基金'?'watchAddEmptyFund':'watchAddEmptyStock')):null,
        h(Status,{resource:s.add,t}),
        s.add.phase==='ready'?h('p',{className:'sti-muted'},t('watchAdded')+': '+(s.add.data?.name||s.add.data?.code||'')):null),
      h(Card,{title:t('watchlist')},
        h('p',{className:'sti-muted'},t('watchHelp')),
        h('div',{className:'sti-actions'},
          h(Button,{onClick:()=>store.loadWatch(),disabled:s.watch.phase==='loading'},t('refresh')),
          h(Button,{primary:true,disabled:s.watchAi.phase==='submitting'||!selected.length,onClick:()=>store.startWatchlistAnalysis(onOpenExpertSession)},t('watchAiStart')),
          h(Button,{disabled:!rows.length,onClick:()=>store.selectAllWatch(selected.length!==rows.length)},selected.length===rows.length?t('watchSelectNone'):t('watchSelectAll'))),
        h('p',{className:'sti-muted'},t('watchAiHelp')),
        s.watchAi.error?h('p',{className:'sti-error',role:'alert'},s.watchAi.error):null,
        s.watchAi.phase==='ready'&&s.watchAi.sessionId?h(Button,{onClick:()=>store.openWatchlistAnalysisSession(onOpenExpertSession)},t('watchAiOpen')):null,
        h(Status,{resource:s.watch,t}),
        rows.length?h(React.Fragment,null,
          h('div',{className:'sti-controls'},h('label',null,t('watchFilter'),h('input',{type:'search',value:filter,maxLength:60,onChange:event=>setFilter(event.target.value)})),
            h('span',{className:'sti-muted',role:'status'},reviewCopy(t,'watchCount',{n:num(shown.length)+(needle?' / '+num(rows.length):'')}))),
          h('p',{className:'sti-muted'},t('watchQuoteNote')+(quoteTime?' '+t('watchQuoteTime')+': '+quoteTime+'.':'')),
          s.watchQuotes.phase==='loading'?h('p',{className:'sti-muted',role:'status'},t('watchQuoteLoading')):null,
          s.watchQuotes.phase==='error'?h('p',{className:'sti-warning',role:'status'},t('watchQuoteFailed')):null,
          shown.length?h(Table,{className:'sti-watch-table',minWidth:560,heads:[t('watchChoose'),{label:t('watchSerial'),className:'sti-idx'},t('code'),{label:t('watchPrice'),className:'sti-num'},{label:t('watchChange'),className:'sti-num'},t('watchActions')],rows:shown.map((item,i)=>{const key=item.code+'|'+item.category,q=quotes[item.code]||null,change=q?q.change:null;
            const trend=change===null||change===undefined?'flat':change>0?'up':change<0?'down':'flat';
            return h('tr',{key:key+'|'+i},
              h('td',null,h('input',{type:'checkbox',checked:!deselected.has(key),'aria-label':(item.name||item.code)+t('watchChoose'),onChange:()=>store.toggleWatchSelected(key)})),
              h('td',{className:'sti-idx'},String(i+1).padStart(2,'0')),
              h('td',null,item.name || '',h('small',null,item.code+' · '+item.category)),
              h('td',{className:'sti-num'},q?num(q.price):'—'),
              h('td',{className:'sti-num sti-quote-'+trend,'data-trend':trend},change===null||change===undefined?'—':(change>0?'+':change<0?'−':'')+num(Math.abs(change),'%')),
              h('td',null,
                h(Button,{onClick:()=>store.openStock(item.code,item.name,item.category)},t('research')),
                h(Button,{onClick:()=>store.removeWatch(item.code,item.category)},t('removeWatch'))));})}):h(Empty,null,t('watchNoMatch'))):h('div',null,h(Empty,null,t('watchEmpty')),h('div',{className:'sti-actions',style:{justifyContent:'center'}},h(Button,{primary:true,onClick:()=>store.navigate('screen')},t('screen')),h(Button,{onClick:()=>store.navigate('stock')},t('stock'))))));
  }
  function reviewCopy(t,key,values={}) {return t(key).replace(/\{(\w+)\}/g,(all,name)=>Object.hasOwn(values,name)?String(values[name]):all);}
  function reviewStatus(t,status) {
    const labels={triggered:'reviewTriggered',reference:'reviewReference',not_triggered:'reviewNotTriggered',invalidated:'reviewInvalidated',pending:'reviewPending',unavailable:'reviewUnavailable',needs_ai:'reviewNeedsAi',ambiguous:'reviewAmbiguous',legacy:'reviewLegacy',multiple_plans:'reviewMultiple'};
    return t(Object.hasOwn(labels,status)?labels[status]:'unknown');
  }
  const reviewComplete=m=>m?.status==='triggered'&&cockpitNumber(m.windows?.['20d'])!==null;
  function reviewNext(m) {
    const options={triggered:reviewComplete(m)?'reviewNextComplete':'reviewNextTriggered',reference:'reviewNextReference',not_triggered:'reviewNextClosed',invalidated:'reviewNextClosed',pending:'reviewNextPending',unavailable:'reviewNextUnavailable',needs_ai:m?.ai?'reviewNextAmbiguous':'reviewNextComplex',ambiguous:'reviewNextAmbiguous',legacy:'reviewNextLegacy',multiple_plans:'reviewNextMultiple'};
    return Object.hasOwn(options,m?.status)?options[m.status]:'reviewNextUnavailable';
  }
  function reviewSummary(t,plans) {
    if(!plans.length)return t('reviewSummaryEmpty');
    const count=(...statuses)=>plans.filter(plan=>statuses.includes(plan.metrics?.status)).length;
    const waiting=count('pending'),triggered=count('triggered'),closed=count('not_triggered','invalidated');
    const complex=plans.filter(plan=>plan.metrics?.status==='needs_ai'&&!plan.metrics.ai).length;
    const ambiguous=count('ambiguous')+count('needs_ai')-complex;
    const completed=plans.filter(plan=>reviewComplete(plan.metrics)).map(plan=>plan.metrics.windows['20d']);
    const parts=[['reviewSummaryWaiting',waiting],['reviewSummaryTriggered',triggered],['reviewSummaryResolved',completed.length],['reviewSummaryClosed',closed],['reviewSummaryComplex',complex],['reviewSummaryAmbiguous',ambiguous],['reviewSummaryReference',count('reference')],['reviewSummaryUnavailable',count('unavailable')]]
      .filter(([,n])=>n).map(([key,n])=>reviewCopy(t,key,{n:num(n)}));
    if(completed.length)parts.push(reviewCopy(t,'reviewSummaryOutcome',{up:num(completed.filter(v=>v>0).length),down:num(completed.filter(v=>v<0).length),flat:num(completed.filter(v=>v===0).length)}));
    if(!triggered)parts.push(t('reviewNoneTriggered'));
    return parts.join(t('reviewSentenceJoin'))+t('reviewSentenceEnd');
  }
  function reviewScope(t,row) {
    if(row.scope==='market')return t('reviewScopeMarket');
    if(row.scope==='watchlist')return t('reviewScopeWatch');
    if(row.scope==='sector')return t('reviewScopeSector')+(row.sector?' · '+investText(row.sector):'');
    return investText(row.scope)||'—';
  }
  function reviewLine(label,value,props={}) {return h('p',props,h('strong',null,label+'：'),value);}
  function reviewConf(t,value) {
    const labels={high:'confidenceHigh',medium:'confidenceMedium',low:'confidenceLow'};
    return t(Object.hasOwn(labels,value)?labels[value]:'unknown');
  }
  function reviewWindows(t,windows,keys=[1,3,5,10,20]) {
    return keys.map(n=>reviewCopy(t,'reviewDays',{n})+' '+pct(windows?.[n+'d'])).join(' · ');
  }
  function ReviewComparison({items,t}) {
    const linked=investReviewItems(items).filter(row=>investReviewId(row.review_id));
    if(!linked.length)return null;
    return h('div',null,h('h4',null,t('reviewComparison')),h('ul',null,...linked.map((row,i)=>h('li',{key:row.review_id+'|'+(row.plan_id||i)},
      h('p',null,[investText(row.expert_name),investText(row.code),investText(row.selected_at),reviewStatus(t,row.status)].filter(Boolean).join(' · ')),
      row.comparison||row.reason?h('p',null,investText(row.comparison||row.reason)):null,
      row.status==='triggered'&&[5,20].some(n=>cockpitNumber(row.windows?.[n+'d'])!==null)?reviewLine(t('reviewPerformance'),reviewWindows(t,row.windows,[5,20])):null,
      row.as_of?reviewLine(t('reviewAsOf'),investText(row.as_of),{className:'sti-muted'}):null,
      h(Button,{onClick:()=>store.openReviewReference(row.review_id,row.plan_id),title:t('reviewRecordId')+' '+row.review_id},t('reviewOpenSource'))))));
  }
  function reviewCause(m,plan,legacy) {
    if(legacy)return 'reviewSourceLegacy';
    if(m.ai||m.trigger?.source==='ai'||m.source==='ai')return 'reviewSourceAi';
    if(m.status==='reference')return 'reviewSourceReference';
    if(m.trigger?.source==='rule'||m.trigger?.source==='close_rule'||plan.plan_kind==='rule'&&m.status!=='unavailable')return 'reviewSourceRule';
    if(m.status==='needs_ai'||plan.plan_kind==='reference')return 'reviewSourceArchive';
    return 'reviewUnknownSource';
  }
  function ReviewPlan({t,plan,legacy,reviewId,judge}) {
    const m=plan.metrics||{},trigger=m.trigger||{},entry=plan.entry||{};
    const displayedStatus=legacy?(m.status==='legacy'?m.historical_status:m.status):m.status;
    const judgeable=!legacy&&investReviewCanJudge(plan),ownJudge=judge.reviewId===reviewId&&judge.planId===plan.plan_id;
    const result=ownJudge?judge.data:null;
    const price=plan.entry_price??trigger.entry_price,direction=plan.entry_direction??trigger.entry_direction,invalid=plan.invalidation_price??trigger.invalidation_price,note=plan.entry_note||trigger.entry_note;
    const condition=cockpitNumber(price)!==null?((direction==='below'?t('reviewAtOrBelow'):direction==='above'?t('reviewAtOrAbove'):'')+' '+num(price)).trim():'';
    const hasWindows=Object.values(m.windows||{}).some(v=>cockpitNumber(v)!==null)||cockpitNumber(m.current)!==null;
    const name=legacy?t('reviewLegacyPlan'):investText(plan.expert_name||plan.expert_id)||t('unknown');
    const evidence=investReviewItems(plan.evidence),evidenceSources=investReviewItems(plan.evidence_sources);
    return h('article',{className:'sti-selection-pick'},
      h('h4',null,name+(plan.expert_tag?' · '+investText(plan.expert_tag):'')+(!legacy?' · '+reviewConf(t,plan.confidence):'')),
      reviewLine(t('reviewStatus'),reviewStatus(t,displayedStatus||(legacy?'legacy':undefined))),
      reviewLine(t('reviewCondition'),[condition,cockpitNumber(invalid)!==null?t('reviewInvalidAt')+' '+num(invalid):'',note&&investText(note)].filter(Boolean).join(' · ')||t('reviewNoCondition')),
      m.reason?h('p',null,investText(m.reason)):null,
      reviewLine(t('reviewNext'),t(legacy?'reviewNextLegacy':reviewNext(m))),
      reviewLine(t('reviewSource'),t(reviewCause(m,plan,legacy)),{className:'sti-muted'}),
      m.status==='triggered'||m.status==='reference'||legacy&&hasWindows?reviewLine(t(m.status==='triggered'&&!legacy?'reviewWindows':'reviewRefWindows'),reviewWindows(t,m.windows)):null,
      judgeable?h('div',null,h('p',{className:'sti-warning'},t('reviewJudgeHelp')),h(Button,{onClick:()=>store.judgeReview(reviewId,plan.plan_id,true),disabled:judge.phase==='loading'},t(ownJudge&&judge.phase==='loading'?'reviewJudgeRunning':'reviewJudge'))):null,
      ownJudge?h(Status,{resource:judge,t}):null,
      result?h('p',{role:'status'},reviewCopy(t,'reviewJudgeResult',{judged:result.judged.length,skipped:result.skipped.length,errors:result.errors.length})):null,
      result?.errors.length?h(Warnings,{items:result.errors.map(item=>item?.error||t('reviewFailedPlan'))}):null,
      h('details',null,h('summary',null,t('evidence')),
        plan.reason?reviewLine(t('reason'),investText(plan.reason)):null,
        plan.why_fit?reviewLine(t('selectionFit'),investText(plan.why_fit)):null,
        plan.selected_at?reviewLine(t('reviewSelectedAt'),investOutputTime(plan.selected_at)):null,
        entry.date||entry.price!=null?reviewLine(t('reviewSelectionEntry'),(investText(entry.date)||'—')+' / '+num(entry.price)):null,
        entry.reason?h('p',{className:'sti-muted'},investText(entry.reason)):null,
        trigger.date?reviewLine(t(m.status==='invalidated'?'reviewInvalidationObserved':'reviewTriggerObserved'),investText(trigger.date)+' / '+num(trigger.price??m.base_price)):
          m.base_date?reviewLine(t('reviewBaseDate'),investText(m.base_date)+' / '+num(m.base_price)):null,
        trigger.price_type==='observed_close'||m.is_fill===false&&(m.base_date||trigger.date)?h('p',{className:'sti-muted'},t('reviewNotFill')):null,
        m.as_of?reviewLine(t('reviewAsOf'),investText(m.as_of)):null,
        cockpitNumber(m.days_waited)!==null?reviewLine(t('reviewWaited'),num(m.days_waited)):null,
        cockpitNumber(m.future_bars)!==null&&m.status==='triggered'?reviewLine(t('reviewAfterEntry'),num(m.future_bars)):null,
        Array.isArray(m.pending_windows)&&m.pending_windows.length?reviewLine(t('reviewAwaitingWindows'),m.pending_windows.map(n=>reviewCopy(t,'reviewDays',{n:num(n)})).join(' · ')):null,
        cockpitNumber(m.current)!==null?reviewLine(t('reviewNow'),pct(m.current)):null,
        cockpitNumber(m.max_drawdown)!==null?reviewLine(t('reviewDrawdown'),pct(m.max_drawdown)):null,
        m.ai?reviewLine(t('reviewAiEvidence'),[reviewStatus(t,m.ai.status),m.ai.reason&&investText(m.ai.reason),m.ai.model&&investText(m.ai.model)].filter(Boolean).join(' · ')):null,
        m.ai?.data_through?reviewLine(t('reviewAiThrough'),investText(m.ai.data_through)):null,
        evidence.length?h(SelectionEvidence,{evidence,sources:evidenceSources,t}):null,
        !plan.reason&&!plan.why_fit&&!plan.selected_at&&!entry.date&&!trigger.date&&!m.base_date&&!m.as_of&&!m.ai&&!evidence.length?h('p',{className:'sti-muted'},t('reviewMissingEvidence')):null));
  }
  function ReviewStats({t,detail}) {
    const experts=investReviewItems(detail.experts),confidence=investReviewItems(detail.confidence),benchmark=detail.benchmark;
    if(!experts.length&&!confidence.length&&!benchmark)return null;
    const rows=(items,expert)=>items.map((row,index)=>h('tr',{key:(expert?(row.expert_id||row.expert):row.confidence)+'|'+index},
      h('td',null,expert?investText(row.expert_name||row.expert||row.expert_id):reviewConf(t,row.confidence),expert&&row.expert_tag?h('small',null,investText(row.expert_tag)):null),
      h('td',null,num(row.picks)),h('td',null,num(row.triggered)),h('td',null,pct(row.trigger_rate)),h('td',null,pct(row.avg_return_5d)),h('td',null,pct(row.win_rate_5d)),expert?h('td',null,row.ranked?num(row.rank):t('reviewNotRanked')):null));
    const heads=[t('reviewPicks'),t('reviewTriggeredCount'),t('reviewTriggerRate'),reviewCopy(t,'reviewDays',{n:5}),t('reviewWinRate')];
    return h('details',null,h('summary',null,t('reviewStats')),
      experts.length?h(React.Fragment,null,h('h3',null,t('reviewByExpert')),h(Table,{heads:[t('reviewExpert'),...heads,t('reviewRank')],rows:rows(experts,true)})):null,
      confidence.length?h(React.Fragment,null,h('h3',null,t('reviewByConfidence')),h(Table,{heads:[t('reviewConfidence'),...heads],rows:rows(confidence,false)})):null,
      benchmark?.windows?h('p',{className:'sti-muted'},t('reviewBench5')+' '+pct(benchmark.windows['5d']?.equal_weight)+' · '+t('reviewBench20')+' '+pct(benchmark.windows['20d']?.equal_weight)):null);
  }
  const portfolioColors=['var(--st-s1,#3786d8)','var(--st-s2,#cd5778)','var(--st-s3,#14a68a)','var(--st-s4,#b28024)','var(--st-s5,#9066ce)','var(--st-s6,#ce7143)','var(--st-s7,#218ba1)','var(--st-s8,#768641)'];
  const portfolioDashes=['','8 4','3 4','12 4 3 4'];
  function portfolioLabel(row) {return investText(row.expert_name||row.expert_id,120);}
  function PortfolioChart({t,series,mode,hasPoints,selectedId}) {
    const visible=series.filter(line=>line.visible&&line.points.some(point=>point.value!==null));
    if(!visible.length)return h(Empty,null,t(hasPoints?'portfolioChartHidden':'portfolioChartEmpty'));
    const W=760,H=244,left=76,right=728,top=16,bottom=210,dayMs=86400000;
    let first=Infinity,last=-Infinity,min=mode==='return'?0:Infinity,max=mode==='return'?0:-Infinity;
    for(const line of visible)for(const point of line.points)if(point.value!==null){
      first=Math.min(first,point.stamp);last=Math.max(last,point.stamp);min=Math.min(min,point.value);max=Math.max(max,point.value);
    }
    const pad=min===max?Math.max(mode==='return'?.001:1,Math.abs(min)*.005):(max-min)*.07;
    min-=pad;max+=pad;
    const x=stamp=>first===last?(left+right)/2:left+(stamp-first)/(last-first)*(right-left);
    const y=value=>bottom-(value-min)/(max-min)*(bottom-top);
    const dates=Array.from(new Set(Array.from({length:5},(_,i)=>first+Math.round((last-first)/dayMs*i/4)*dayMs)));
    const values=[0,1,2,3,4].map(i=>min+(max-min)*i/4);
    const fmt=mode==='return'?pct:value=>value.toLocaleString(undefined,{maximumFractionDigits:2});
    const title=t(mode==='return'?'portfolioReturns':'portfolioNav')+' · '+t('portfolioDate');
    return h('figure',{className:'sti-chart'},
      h('div',{className:'sti-table-scroll'},h('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':title,style:{minWidth:480,maxHeight:320}},
        h('title',null,title),
        ...values.map((value,i)=>h('g',{key:i},
          h('line',{className:'sti-gridline',x1:left,y1:y(value),x2:right,y2:y(value)}),
          h('text',{className:'sti-chart-label',x:left-8,y:y(value)+4,textAnchor:'end'},fmt(value)))),
        ...dates.map(stamp=>h('g',{key:stamp},
          h('line',{className:'sti-gridline',x1:x(stamp),y1:top,x2:x(stamp),y2:bottom}),
          h('text',{className:'sti-chart-label',x:x(stamp),y:bottom+20,textAnchor:stamp===first&&first!==last?'start':stamp===last&&last!==first?'end':'middle'},new Date(stamp).toISOString().slice(0,10)))),
        mode==='return'?h('line',{stroke:'var(--dsw-alias-label-secondary)',strokeDasharray:'3 5',opacity:.65,x1:left,y1:y(0),x2:right,y2:y(0)}):null,
        ...[...visible].sort((a,b)=>Number(a.id===selectedId)-Number(b.id===selectedId)).map(line=>{
          const selected=line.id===selectedId;
          const runs=[];let run=[];
          for(const point of line.points){if(point.value===null){if(run.length)runs.push(run);run=[];}else run.push(point);}
          if(run.length)runs.push(run);
          return h('g',{key:line.id===null?'benchmark':'expert:'+line.id,'data-series':line.id??'csi300'},
            h('title',null,line.name),
            ...runs.map((group,i)=>{
              const lastPoint=group.at(-1),marker=point=>h('circle',{cx:x(point.stamp),cy:y(point.value),r:selected?3.7:2.8,fill:line.color},
                h('title',null,line.name+' · '+point.date+' · '+fmt(point.value)));
              return h('g',{key:i},group.length>1?h('path',{d:group.map((point,j)=>(j?'L':'M')+x(point.stamp).toFixed(2)+' '+y(point.value).toFixed(2)).join(' '),fill:'none',stroke:line.color,strokeWidth:selected?2.8:1.8,strokeDasharray:line.dash||undefined,strokeLinecap:'round',strokeLinejoin:'round',vectorEffect:'non-scaling-stroke'}):null,marker(lastPoint));
            }));
        }))),
      h('figcaption',null,t('portfolioChartNote'),h('p',null,t('portfolioLatest')+': '+visible.map(line=>{const p=line.points.findLast(point=>point.value!==null);return line.name+' '+fmt(p.value)+' ('+p.date+')';}).join(' · '))));
  }
  function portfolioTradeDate(date,price) {return (investText(date)||'—')+' / '+num(price);}
  function portfolioStock(row) {return [investText(row.name,100),investText(row.code,32)].filter(Boolean).join(' · ')||'—';}
  function portfolioSignedPercent(value) {return (cockpitNumber(value)!==null&&value>0?'+':'')+pct(value);}
  function portfolioMoney(t,value,signed=false) {
    const n=cockpitNumber(value);if(n===null)return '—';
    return (signed&&n>0?'+':'')+num(n)+' '+t('portfolioCny');
  }
  function PortfolioStockDetails({t,expert}) {
    const stock='portfolioStock',entry='portfolioEntry',reason='portfolioReason',pnl='portfolioPnl',ret='portfolioTradeReturn';
    const groups=[
      ['portfolioOpen','portfolioNoOpen',expert.positions,[stock,entry,'portfolioQuantity','portfolioClose','portfolioStop',pnl,ret,reason],row=>[portfolioStock(row),portfolioTradeDate(row.entry_date,row.entry_price),num(row.quantity),num(row.close_price),num(row.stop_price),portfolioMoney(t,row.pnl,true),portfolioSignedPercent(row.return),investText(row.reason)||'—']],
      ['portfolioQueued','portfolioNoQueued',expert.pending,[stock,'portfolioDirection','portfolioDecision',reason,'portfolioOrderWait'],row=>[portfolioStock(row),['buy','sell'].includes(row.side)?t(row.side==='buy'?'portfolioBuy':'portfolioSell'):investText(row.side)||'—',row.decision_date?investText(row.decision_date):investOutputTime(row.decision_at),investText(row.reason)||'—',investText(row.status_reason)||'—']],
      ['portfolioClosed','portfolioNoClosed',expert.closed,[stock,entry,'portfolioExit',pnl,ret,reason],row=>[portfolioStock(row),portfolioTradeDate(row.entry_date,row.entry_price),portfolioTradeDate(row.exit_date,row.exit_price),portfolioMoney(t,row.pnl,true),portfolioSignedPercent(row.return),investText(row.reason)||'—']],
      ['portfolioContributions','portfolioNoContributions',investPortfolioContributions(expert),[stock,'portfolioUnrealized','portfolioRealized',pnl],row=>[portfolioStock(row),portfolioMoney(t,row.open,true),portfolioMoney(t,row.closed,true),portfolioMoney(t,row.total,true)]],
    ];
    return groups.map(([title,empty,items,heads,cells])=>h('details',{key:expert.expert_id+'|'+title,open:title==='portfolioOpen'?true:undefined,className:'sti-selection-evidence'},
      h('summary',null,t(title)+' · '+num(items.length)),
      title==='portfolioContributions'?h('p',{className:'sti-muted'},t('portfolioContributionNote')):null,
      items.length?h(Table,{heads:heads.map(t),minWidth:heads.length*101,rows:items.map((row,i)=>h('tr',{key:row.id||i},...cells(row).map((value,j)=>h('td',{key:j},value))))}):h('p',{className:'sti-muted'},t(empty))));
  }
  function PortfolioDashboard({t}) {
    const s=useStore(),current=s.portfolios,view=s.portfolioView;
    const loadedBase=React.useRef(null);
    React.useEffect(()=>{
      if(s.connection.ready&&loadedBase.current!==s.connection.apiBase){loadedBase.current=s.connection.apiBase;void store.loadPortfolios();}
    },[s.connection.ready,s.connection.apiBase]);
    const refresh=h(Button,{onClick:()=>store.loadPortfolios(),disabled:!s.connection.ready||current.phase==='loading'},t('portfolioRefresh'));
    const head=children=>h(Card,{title:t('portfolioTitle'),className:'sti-portfolio'},h('p',{className:'sti-muted'},t('portfolioIntro')),children);
    if(current.phase!=='ready')return head(h(React.Fragment,null,h('div',{className:'sti-actions'},refresh),h(Status,{resource:current,t}),!s.connection.ready&&current.phase==='idle'?h(Empty,null,t('offline')):null));
    const data=current.data,items=data.items,mode=view.mode,start=typeof data.started_on==='string'?data.started_on.slice(0,10):null;
    if(!items.some(row=>row.curve.length||row.positions.length||row.closed.length||row.pending.length))return head(h(React.Fragment,null,h(Empty,null,t('portfolioEmpty')),h('div',{className:'sti-actions'},h(Button,{primary:true,onClick:()=>store.navigate('screen')},t('portfolioGoSelect')),refresh)));
    const selection=items.find(row=>row.expert_id===view.expertId)||items[0];
    const series=items.map((row,i)=>({id:row.expert_id,name:portfolioLabel(row),points:investPortfolioPoints(row.curve,mode,start),
      color:portfolioColors[i%portfolioColors.length],dash:portfolioDashes[Math.floor(i/portfolioColors.length)%portfolioDashes.length],visible:!view.hiddenExperts.includes(row.expert_id)}));
    const benchmarkHistory=data.benchmark?.available===false?[]:(data.benchmark?.history??data.benchmark?.points);
    const benchmarkPoints=investPortfolioPoints(benchmarkHistory,mode,start);
    const hasValues=points=>points.some(point=>point.value!==null);
    const benchmarkVisibleValues=hasValues(benchmarkPoints),hasPoints=series.some(line=>hasValues(line.points));
    const benchmarkReturnAvailable=mode==='return'?benchmarkVisibleValues:hasValues(investPortfolioPoints(benchmarkHistory,'return',start));
    const benchmarkName=!data.benchmark?.name||['沪深300','CSI 300','CSI300'].includes(data.benchmark.name)?t('portfolioBenchmark'):investText(data.benchmark.name,90);
    const showBenchmark=benchmarkVisibleValues&&hasPoints;
    // The benchmark is never substituted with the old review's equal-weight stock returns.
    const benchmark={id:null,name:benchmarkName,points:benchmarkPoints,color:'var(--dsw-alias-label-secondary)',dash:'7 5',visible:view.benchmark};
    const active=showBenchmark?[...series,benchmark]:series;
    const wins=investFactorCount(selection.wins)?num(selection.wins):'—',closes=investFactorCount(selection.closed_count)?num(selection.closed_count):'—';
    const winRate=selection.closed_count>0?pct(selection.win_rate):'—';
    const ruleInfo=[investPortfolioDate(start)!==null?t('portfolioStart')+': '+start:null,
      cockpitNumber(data.initial_cash)!==null?t('portfolioInitial')+': '+portfolioMoney(t,data.initial_cash):null,
      investFactorCount(data.max_positions)?t('portfolioMaxPositions')+': '+num(data.max_positions):null,
      cockpitNumber(data.position_weight)!==null?t('portfolioWeight')+': '+pct(data.position_weight):null].filter(Boolean);
    return head(h(React.Fragment,null,
      ruleInfo.length?h('p',{className:'sti-muted'},ruleInfo.join(' · ')):null,
      h('div',{className:'sti-actions',style:{justifyContent:'space-between',marginTop:12}},
        h('div',{className:'sti-actions',role:'group','aria-label':t('portfolioMode')},...['return','nav'].map(key=>h(Button,{key,'aria-pressed':mode===key,onClick:()=>store.portfolioMode(key)},t(key==='return'?'portfolioReturns':'portfolioNav')))),refresh),
      h('div',{className:'sti-actions',role:'group','aria-label':t('portfolioShowSeries'),style:{margin:'10px 0 6px'}},
        ...series.map(line=>h(Button,{key:line.id,'aria-pressed':line.visible,onClick:()=>store.togglePortfolioSeries(line.id)},h('span',{style:{color:line.color},'aria-hidden':'true'},line.dash?'┄ ':'━ '),line.name)),
        showBenchmark?h(Button,{'aria-pressed':view.benchmark,onClick:()=>store.togglePortfolioBenchmark()},h('span',{'aria-hidden':'true'},'┄ '),benchmarkName):null),
      !benchmarkVisibleValues?h('p',{className:'sti-muted'},t(benchmarkReturnAvailable?'portfolioBenchmarkOnly':'portfolioBenchmarkMissing')):null,
      h(PortfolioChart,{t,series:active,mode,hasPoints,selectedId:selection.expert_id}),
      h('div',{className:'sti-controls'},h('label',null,t('portfolioExpert'),h('select',{value:selection.expert_id,onChange:event=>store.portfolioExpert(event.target.value)},...items.map(row=>h('option',{key:row.expert_id,value:row.expert_id},portfolioLabel(row)))))),
      investPortfolioDate(selection.as_of)!==null?h('p',{className:'sti-muted'},t('portfolioAsOf')+': '+selection.as_of):null,
      h('dl',{className:'sti-metrics',style:{gridTemplateColumns:'repeat(auto-fit,minmax(min(145px, 100%),1fr))'}},
        h(Metric,{label:t('portfolioTotalReturn'),value:portfolioSignedPercent(selection.total_return)}),
        h(Metric,{label:t('portfolioNav'),value:portfolioMoney(t,selection.nav)}),
        h(Metric,{label:t('portfolioDrawdown'),value:pct(selection.max_drawdown)}),
        h(Metric,{label:t('portfolioCash'),value:portfolioMoney(t,selection.cash)}),
        h(Metric,{label:t('portfolioRealized'),value:portfolioMoney(t,selection.realized_pnl,true)}),
        h(Metric,{label:t('portfolioUnrealized'),value:portfolioMoney(t,selection.unrealized_pnl,true)}),
        h(Metric,{label:t('portfolioWinRate'),value:winRate+' · '+wins+' / '+closes})),
      h(Warnings,{items:Array.isArray(selection.warnings)?selection.warnings:[]}),
      h(PortfolioStockDetails,{t,expert:selection}),
      data.assumptions?.fees_included===false&&data.assumptions?.corporate_actions_included===false?h('p',{className:'sti-muted'},t('portfolioNoCosts')):null));
  }
  function DailyReview({t,onOpenExpertSession}) {
    const s=useStore(),busy=s.dailyStart.phase==='loading',past=s.dailyHistory.data||[];
    React.useEffect(()=>{void store.loadDailyHistory();},[]);
    return h('div',{className:'sti-invest sti-daily-review','data-view':'daily-review'},
      h('header',{className:'sti-heading'},h('h1',null,t('review'))),
      h('section',{className:'sti-card sti-daily-controls','aria-label':t('review')},
        h('div',null,h(Button,{primary:true,onClick:()=>store.startDailyReview(onOpenExpertSession),disabled:busy||!s.connection.ready||!onOpenExpertSession},t(busy?'dailyStarting':'dailyRun')),
          h('p',{className:'sti-muted'},t('dailyIntro')),h(ErrorView,{error:s.dailyStart.error,t})),
        h('div',null,h('label',null,t('dailyHistory'),h('select',{value:'',disabled:!past.length||!onOpenExpertSession,onChange:e=>store.openDailyReview(e.target.value,onOpenExpertSession)},
          h('option',{value:'',disabled:true},t('dailyChoose')),...past.map(row=>h('option',{key:row.date,value:row.date},row.date)))),
          h(Status,{resource:s.dailyHistory,t}),s.dailyHistory.phase==='ready'&&!past.length?h('p',{className:'sti-muted'},t('dailyEmpty')):null)),
      !onOpenExpertSession?h('p',{role:'status',className:'sti-muted'},t('dailySessionMissing')):null);
  }
  function Review({t}) {return h(React.Fragment,null,h(PortfolioDashboard,{t}),
    h('section',{'aria-label':t('reviewSignalTitle')},h('h2',null,t('reviewSignalTitle')),h('p',{className:'sti-muted'},t('reviewSignalNote')),h(SignalReview,{t})));}
  function SignalReview({t}) {
    const s=useStore(),list=s.reviews.data?.items||[],detail=s.reviewDetail.data;
    React.useEffect(()=>{if(s.connection.ready)void store.refreshReviews();},[s.connection.ready]);
    const targets=investReviewItems(detail?.targets),plans=targets.flatMap(item=>investReviewItems(item.plans)),legacy=investReviewLegacy(detail);
    const complexIds=legacy?[]:[...new Set(plans.filter(plan=>investReviewCanJudge(plan)).map(plan=>plan.plan_id))];
    const pendingArchive=Math.max(0,Number(s.reviews.data?.pending_archive)||0);
    const opened=list.find(row=>row.id===s.reviewId)||detail,loading=s.reviews.phase==='loading'||s.reviewDetail.phase==='loading'||s.reviewSyncing;
    const currentIsLatest=list[0]?.id===s.reviewId;
    const next=[...new Set(legacy?['reviewNextLegacy']:plans.map(plan=>reviewNext(plan.metrics)))];
    return h(Card,{title:opened?(currentIsLatest?t('reviewLatest'):t('reviewHistoryBatch'))+(opened.archived_at?' · '+investOutputTime(opened.archived_at):''):t('reviewAnswers')},
      h('div',{className:'sti-actions'},
        h(Button,{onClick:()=>store.refreshReviews(),disabled:loading||!s.connection.ready},t('reviewRefresh')),
        legacy?null:h(Button,{onClick:()=>{
          if(!complexIds.length)return;
          const ask=typeof confirm==='function'?confirm(reviewCopy(t,'reviewJudgeBatchConfirm',{n:num(complexIds.length)})):true;
          if(ask)void store.judgeBatch(s.reviewId,complexIds,true);
        },disabled:loading||!s.connection.ready||!complexIds.length||s.reviewJudgeBatch.phase==='loading'},
          s.reviewJudgeBatch.phase==='loading'?t('reviewJudgeBatchRunning'):t('reviewJudgeBatch'))),
      h(Status,{resource:s.reviewJudgeBatch,t}),
      s.reviewJudgeBatch.data?reviewLine(t('reviewJudgeBatch'),reviewCopy(t,'reviewJudgeBatchResult',{judged:num(s.reviewJudgeBatch.data.judged.length),skipped:num(s.reviewJudgeBatch.data.skipped.length),errors:num(s.reviewJudgeBatch.data.errors.length)}),{className:'sti-muted'}):null,
      h(Status,{resource:s.reviews,t}),h(Status,{resource:s.reviewDetail,t}),
      detail?h(React.Fragment,null,
        h('p',{className:'sti-muted'},[reviewScope(t,detail),num(targets.length)+' '+t('reviewStockUnit'),!legacy?num(detail.plan_count??plans.length)+' '+t('reviewPlanUnit')+t('reviewPlans'):null,t('reviewRecordId')+' '+investText(s.reviewId)].filter(Boolean).join(' · ')),
        h('p',{role:'status'},h('strong',null,t('reviewAnswers')+'：'),legacy?t('reviewSummaryLegacy'):reviewSummary(t,plans)),
        next.length?reviewLine(t('reviewNext'),next.map(t).join(t('reviewSentenceJoin'))+t('reviewSentenceEnd')):null,
        reviewLine(t('source'),t(legacy?'reviewSourceLegacy':'reviewBatchSource'),{className:'sti-muted'}),
        legacy?h('p',{className:'sti-warning'},t('reviewLegacyBatch')):null,
        h('h3',null,t('reviewStockPlans')),
        targets.map((item,index)=>{
          const stored=investReviewItems(item.plans),useLegacy=legacy||!Array.isArray(item.plans),rows=useLegacy?[item]:stored;
          const statuses=useLegacy?[reviewStatus(t,item.metrics?.status||'legacy')]:[...new Set(rows.map(plan=>reviewStatus(t,plan.metrics?.status)))];
          const focus=!!s.reviewFocusPlanId&&rows.some(plan=>plan.plan_id===s.reviewFocusPlanId);
          return h('details',{key:s.reviewId+'|'+item.code+'|'+index,...(focus?{open:true}:{})},
            h('summary',null,[investText(item.name),investText(item.code),!useLegacy?num(rows.length)+' '+t('reviewPlanUnit')+t('reviewPlans'):null,statuses.join(' / ')].filter(Boolean).join(' · ')),
            (useLegacy&&Array.isArray(item.experts)&&item.experts.length)?reviewLine(t('reviewExperts'),item.experts.map(name=>investText(name)).join(' / '),{className:'sti-muted'}):null,
            rows.length?rows.map((plan,i)=>h(ReviewPlan,{key:plan.plan_id||i,t,plan,legacy:useLegacy,reviewId:s.reviewId,judge:s.reviewJudge})):h('p',null,t('reviewPlanMissing')));
        }),
        !legacy?h(ReviewStats,{t,detail}):null,
        h('details',null,h('summary',null,t('reviewNotes')),
          h('p',{className:'sti-muted'},t('reviewHelp')),h(Warnings,{items:detail.warnings}))):null,
      !detail&&s.reviews.phase==='ready'&&list.length===0&&!s.reviewId?h(Empty,null,t('reviewEmpty')):null,
      h('details',null,h('summary',null,t('reviewHistory')+(list.length?' · '+num(list.length):'')),
        pendingArchive?h('div',{className:'sti-actions'},
          h(Button,{onClick:()=>store.syncReviews(),disabled:loading||!s.connection.ready},t('reviewSync')),
          h('small',{className:'sti-muted'},reviewCopy(t,'reviewSyncPending',{n:num(pendingArchive)}))):null,
        list.length?h(Table,{heads:[t('reviewTime'),t('reviewScope'),t('reviewTargets'),''],rows:list.map(row=>h('tr',{key:row.id},
          h('td',null,investOutputTime(row.archived_at)),h('td',null,reviewScope(t,row)),h('td',null,num(row.target_count)),h('td',null,h(Button,{onClick:()=>store.openReview(row.id),'aria-pressed':s.reviewId===row.id},t('reviewOpen')))))}):null));
  }
  function IntegrationBanner({t,integration,onRecheck}) {
    const data=integration.data;
    if(!data||data.available!==false)return null;
    const copy=v=>{try{navigator.clipboard?.writeText(v);publish({notice:t('integrationCopied')});}catch{}};
    return h(Card,{title:t('integrationTitle')},
      h('p',null,t('integrationBody')),
      h('ol',{className:'sti-muted'},
        h('li',null,t('integrationStep1')),
        h('li',null,t('integrationStep2')),
        h('li',null,t('integrationStep3'))),
      h('div',{className:'sti-actions'},(data.preset||[]).map(item=>h(Button,{key:item.id,onClick:()=>copy(item.url)},item.name+' · '+item.url))),
      h('div',{className:'sti-actions'},h(Button,{onClick:onRecheck},t('integrationRecheck'))));
  }

  function Invest({tab,t,onAnalyze,onOpenExpertSession}) {const s=useStore();React.useEffect(()=>{if(tab!=='review'&&s.connection.ready&&s.integration.phase==='idle')void store.loadIntegration();},[tab,s.connection.ready,s.integration.phase]);if(tab==='review'&&s.reviewMode!=='source')return h(DailyReview,{t,onOpenExpertSession});return h('div',{className:'sti-invest','data-view':tab},h(IntegrationBanner,{t,integration:s.integration,onRecheck:()=>store.loadIntegration()}),h('header',{className:'sti-heading'},h('p',{className:'sti-eyebrow'},'SUPER TRADER'),h('h1',null,t(tab)),h('p',null,t('workflow'))),h('p',{className:'sti-disclaimer'},t('disclaimer')),h(ErrorView,{error:s.notice,t}),tab==='screen'?h(Screen,{t,onOpenExpertSession}):tab==='stock'?h(Stock,{t,onAnalyze,onOpenExpertSession}):tab==='sectors'?h(Sectors,{t,onAnalyze,onOpenExpertSession}):tab==='experts'?h(Experts,{t,onOpenExpertSession}):tab==='factors'?h(Factors,{t}):tab==='review'?h(React.Fragment,null,h(Button,{onClick:store.closeReviewReference},t('dailyReturn')),h(Review,{t})):h(Watchlist,{t,onOpenExpertSession}));}
  return {Invest,Screen,Stock,Sectors,Experts,Watchlist,Review,investFieldLabel,Candles,Quant,Brief,Vote,TeamResult,SelectionResult,SelectionEvidence,Factors,FactorTranscript,FactorCurve,FactorMetrics,FactorSamples};
}
