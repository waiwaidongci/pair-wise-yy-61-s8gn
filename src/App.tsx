import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Tab,
  TabList,
  Tag,
  Textarea,
  webLightTheme
} from '@fluentui/react-components';
import {
  AlertRegular,
  ArrowDownloadRegular,
  ArrowSyncRegular,
  BookOpenRegular,
  CheckmarkCircleRegular,
  ClipboardTaskListLtrRegular,
  CloudArrowUpRegular,
  CloudOffRegular,
  DocumentBulletListRegular,
  GaugeRegular,
  HistoryRegular,
  LockClosedRegular,
  NavigationRegular,
  PeopleRegular,
  PlugConnectedRegular,
  WarningRegular
} from '@fluentui/react-icons';
import {
  LOCAL_DEVICE,
  useArmFailureMutation,
  useBumpCardRevisionMutation,
  useGetWorkPackageQuery,
  usePeerChangeMutation
} from './api';
import type { MergeFieldKey } from './api';
import {
  dismissChange,
  editDraft,
  pullSnapshot,
  queueComplete,
  rebaseOverrideChange,
  releasePackage,
  requestOverride,
  resolveFieldConflict,
  selectCard,
  selectDraftValue,
  selectOverrideState,
  selectPendingFieldChange,
  setConflict,
  signStage,
  syncNow,
  toggleOffline,
  type AppDispatch,
  type PendingChange,
  type RootState
} from './store';

const FIELD_LABEL: Record<MergeFieldKey, string> = { measurement: '测量值', finding: '发现项', witness: '见证确认' };
const STAGE_ACTOR: Record<string, string> = { 系统: '韩磊 · 系统工程师', 动力: '高翔 · 动力工程师', 放行: '周正 · 质量经理' };

const useAppDispatch = () => useDispatch<AppDispatch>();

type NavItem = { path: string; label: string; icon: ReactNode };

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const pendingCount = state.changes.filter((item) => item.status === '待合并' || item.status === '提交失败').length;

  /* 网络恢复：自动逐字段合并本地待处理改动，再拉取服务器快照 */
  useEffect(() => {
    if (!state.offline && !state.syncing && (pendingCount > 0 || state.syncError)) {
      void dispatch(syncNow()).then(() => dispatch(pullSnapshot()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.offline]);

  const nav: NavItem[] = [
    { path: '/', label: '工作包总览', icon: <ClipboardTaskListLtrRegular /> },
    { path: '/execution', label: '工卡执行', icon: <BookOpenRegular /> },
    { path: '/release', label: '放行审阅', icon: <LockClosedRegular /> },
    { path: '/audit', label: '审计与溯源', icon: <HistoryRegular /> }
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon"><NavigationRegular /></div>
          <div><strong>航空定检执行台</strong><span>Maintenance Work Package</span></div>
        </div>
        <div className="aircraft-chip"><span>B-7891</span><strong>B737-800</strong><Badge appearance="tint" color="brand">48A 定检</Badge></div>
        <div className="header-spacer" />
        <button className={`sync-status ${state.offline ? 'offline' : ''}`} onClick={() => dispatch(toggleOffline())}>
          {state.offline ? <CloudOffRegular /> : <CloudArrowUpRegular />}
          <span>{state.offline ? `离线暂存 · ${pendingCount} 项待合并` : `已同步 R${state.server.serverRevision}${pendingCount ? ` · ${pendingCount} 项合并中` : ''}`}</span>
        </button>
        {!state.offline && <Button size="small" appearance="subtle" icon={<ArrowSyncRegular />} onClick={() => void dispatch(syncNow()).then(() => dispatch(pullSnapshot()))}>立即合并</Button>}
        <div className="user-chip"><span>执行人员</span><strong>宋杰 · 机械</strong></div>
      </header>
      <div className="shell-grid">
        <aside className="side-nav">
          <div className="package-summary">
            <span>工作包</span><strong>WP-B7891-04</strong><small>上海浦东 · H3 机库</small>
            <div><ProgressBar value={state.server.tasks.filter((card) => card.status === '已完成').length / state.server.tasks.length} /><span>{state.server.tasks.filter((card) => card.status === '已完成').length}/{state.server.tasks.length} 工卡完成</span></div>
          </div>
          <nav>{nav.map((item) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span></NavLink>)}</nav>
          <div className="side-status">
            <WarningRegular />
            <div><strong>{state.server.tasks.filter((card) => card.status === '待授权').length} 项待授权</strong><span>{pendingCount} 项改动等待联网逐字段合并</span></div>
          </div>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div>;
}

function TraceChip({ rev, source, time, conflicted }: { rev: number; source: string; time: string; conflicted?: boolean }) {
  return <span className={`trace-chip ${conflicted ? 'warn' : ''}`} title={`来源：${source} · 设备：${LOCAL_DEVICE}`}>修订 #{rev} · {source.length > 16 ? `${source.slice(0, 16)}…` : source} · {time}</span>;
}

/* 差异待决卡片：后到方先看差异，再决定采用谁，绝不直接覆盖 */
function ConflictCard({ change }: { change: PendingChange }) {
  const dispatch = useAppDispatch();
  const [custom, setCustom] = useState('');
  const conflict = change.conflict;
  if (!conflict) return null;
  const label = change.kind === 'signature' ? `${change.stage}阶段签署` : `${change.cardId} ${FIELD_LABEL[change.field as MergeFieldKey]}`;
  return (
    <div className="conflict-card">
      <div className="conflict-head"><WarningRegular /><strong>{label} 字段差异待决</strong><Tag size="extra-small" appearance="outline">后到方</Tag></div>
      <div className="diff-mini">
        <div><small>本地基线（修订 #{change.baseRev}）</small><del>{conflict.baseValue || '（空）'}</del></div>
        <div><small>先到方（服务器 修订 #{conflict.serverRev}）</small><ins>{conflict.serverValue || '（空）'}<b>{conflict.serverSource} · {conflict.serverTime}</b></ins></div>
        <div><small>本方待提交值</small><strong>{conflict.localValue || '（空）'}</strong></div>
      </div>
      {change.kind === 'signature' ? (
        <p className="conflict-note">阶段签署不得覆盖先到方数据；如确需重签，请联系质量流程线下处理。</p>
      ) : (
        <Field label="改用新值（可选）"><Input value={custom} onChange={(_, data) => setCustom(data.value)} placeholder="查看差异后填入合并值" /></Field>
      )}
      <div className="conflict-actions">
        <Button size="small" appearance="primary" onClick={() => dispatch(resolveFieldConflict({ localId: change.localId, decision: 'theirs' }))}>采用先到方</Button>
        {change.kind === 'field' && <>
          <Button size="small" onClick={() => dispatch(resolveFieldConflict({ localId: change.localId, decision: 'mine' }))}>保留本方并再提交</Button>
          <Button size="small" appearance="subtle" disabled={!custom.trim()} onClick={() => dispatch(resolveFieldConflict({ localId: change.localId, decision: 'custom', customValue: custom.trim() }))}>提交新值</Button>
        </>}
      </div>
    </div>
  );
}

/* 离线待合并队列：逐字段、带修订号与来源；失败保留、重试只提交一次 */
function PendingQueue({ onReauthorize }: { onReauthorize: (cardId: string, localId?: string) => void }) {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const active = state.changes.filter((item) => item.status !== '已合并');
  const merged = state.changes.filter((item) => item.status === '已合并').length;
  const conflicts = active.filter((item) => item.status === '差异待决');
  const others = active.filter((item) => item.status !== '差异待决');
  if (active.length === 0) {
    return <section className="panel queue-panel"><div className="panel-head"><h2>修订合并队列</h2><CheckmarkCircleRegular /></div><p className="queue-empty">没有待合并改动{merged > 0 ? `，本轮已逐字段合并 ${merged} 项` : ''}。</p></section>;
  }
  return (
    <section className="panel queue-panel">
      <div className="panel-head"><div><h2>修订合并队列</h2><span>{active.length} 项待处理 · 每项携带修订号与来源</span></div><Tag appearance="brand">{state.offline ? '离线' : '在线'}</Tag></div>
      {state.syncError && <MessageBar intent="error" className="queue-banner"><MessageBarBody><strong>写入失败，原草稿与待合并改动均已保留。</strong>{state.syncError}</MessageBarBody></MessageBar>}
      <div className="queue-list">
        {conflicts.map((change) => <ConflictCard key={change.localId} change={change} />)}
        {others.map((change) => (
          <div className={`queue-item ${change.status === '提交失败' ? 'failed' : change.status === '授权已作废' || change.status === '被拒绝' ? 'invalid' : ''}`} key={change.localId}>
            <div className="queue-item-main"><strong>{change.label}</strong><small>来源 {change.origin} · {change.device}</small>{change.reason && <small className="queue-reason">{change.reason}</small>}</div>
            {change.status === '待合并' && <Badge appearance="tint" color="brand">待合并</Badge>}
            {change.status === '提交失败' && <Button size="small" appearance="primary" onClick={() => void dispatch(syncNow())}>重试</Button>}
            {change.status === '授权已作废' && change.cardId && <Button size="small" appearance="primary" onClick={() => onReauthorize(change.cardId!, change.localId)}>新版本重授</Button>}
            {change.status === '被拒绝' && <Button size="small" appearance="subtle" onClick={() => dispatch(dismissChange(change.localId))}>知道了</Button>}
          </div>
        ))}
      </div>
      <div className="queue-foot">
        <Button appearance="primary" size="small" icon={<PlugConnectedRegular />} disabled={state.offline || state.syncing} onClick={() => void dispatch(syncNow()).then(() => dispatch(pullSnapshot()))}>网络恢复后逐字段合并</Button>
        <span>重试沿用原改动令牌，服务器幂等去重，只提交一次</span>
      </div>
    </section>
  );
}

function Overview() {
  const state = useSelector((root: RootState) => root.maintenance);
  const { data } = useGetWorkPackageQuery();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const completed = state.server.tasks.filter((card) => card.status === '已完成').length;
  const blockers = state.server.tasks.filter((card) => card.status === '待授权');
  const pendingCount = state.changes.filter((item) => item.status === '待合并' || item.status === '提交失败').length;
  return (
    <div className="page">
      <PageHeading
        eyebrow="WP-B7891-04 / 48A CHECK"
        title="工作包总览"
        description="监控工卡依赖、字段级修订、阶段签署、超差版本绑定和放行门禁。"
        actions={<><Button appearance="secondary" icon={<ArrowDownloadRegular />}>导出进度</Button><Button appearance="primary" icon={<NavigationRegular />} onClick={() => navigate('/execution')}>继续执行</Button></>}
      />
      {blockers.length > 0 && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>放行阻断：</strong>{blockers.map((card) => `${card.id} ${card.title}（${card.revision}）`).join('、')} 的超差授权须与当前工卡版本一致。</MessageBarBody></MessageBar>}
      {pendingCount > 0 && <MessageBar intent={state.offline ? 'warning' : 'info'} className="top-message"><MessageBarBody>{state.offline ? '内网断开，' : ''}有 <strong>{pendingCount}</strong> 项字段修订待网络恢复后逐字段合并，测量值/发现项/见证/签署各自独立不互相覆盖。</MessageBarBody></MessageBar>}
      <div className="metrics-grid">
        {[
          ['工卡完成度', `${completed} / ${state.server.tasks.length}`, `${Math.round(completed / state.server.tasks.length * 100)}%`, 'green'],
          ['待合并修订', String(pendingCount), state.offline ? '离线暂存于本机' : '恢复网络即提交', 'blue'],
          ['差异待决', String(state.changes.filter((item) => item.status === '差异待决').length), '后到方先看差异', 'amber'],
          ['待签署阶段', String(state.server.signatures.filter((item) => item.status === '待签署').length), '放行前完成', 'red']
        ].map((item) => <div className="metric-card" key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small className={item[3]}>{item[2]}</small></div>)}
      </div>
      <div className="overview-grid">
        <section className="panel task-panel">
          <div className="panel-head"><div><h2>关键工卡与依赖</h2><span>按执行依赖和风险排序</span></div><Badge appearance="tint">{data?.revision ?? state.server.revision}</Badge></div>
          {state.server.tasks.map((card, index) => (
            <button key={card.id} className={`task-row ${state.activeCardId === card.id ? 'active' : ''}`} onClick={() => { dispatch(selectCard(card.id)); navigate('/execution'); }}>
              <span className={`task-index ${card.status === '已完成' ? 'done' : card.status === '待授权' ? 'blocked' : ''}`}>{card.status === '已完成' ? <CheckmarkCircleRegular /> : index + 1}</span>
              <span className="task-main"><strong>{card.id} · {card.title}</strong><small>{card.zone} · 工卡 {card.revision} · 依赖 {card.dependencies.length ? card.dependencies.join('、') : '无'}</small></span>
              <Tag appearance="outline" size="small">{card.stage}</Tag>
              <Badge appearance="tint" color={card.status === '已完成' ? 'success' : card.status === '待授权' ? 'danger' : card.status === '执行中' ? 'brand' : 'informative'}>{card.status}</Badge>
            </button>
          ))}
        </section>
        <aside className="overview-side">
          <section className="panel stage-panel"><div className="panel-head"><h2>阶段签字（带修订号）</h2><PeopleRegular /></div>{state.server.signatures.map((item) => <div className="signature-row" key={item.stage}><span className={item.status === '已签署' ? 'signed' : ''}>{item.status === '已签署' ? <CheckmarkCircleRegular /> : item.stage.slice(0, 1)}</span><div><strong>{item.stage}签署 {item.status === '已签署' && <em>#{item.rev}</em>}</strong><small>{item.actor || '待指定'} · {item.time}</small></div></div>)}</section>
          <section className="panel dependency-panel"><div className="panel-head"><h2>依赖路径</h2><GaugeRegular /></div><div className="dependency-graph"><span>CARD-01</span><i /><span>CARD-02</span><i /><span className="critical">CARD-03</span><i /><span>CARD-07</span><i /><span>CARD-08</span></div></section>
        </aside>
      </div>
    </div>
  );
}

function Execution() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const card = state.server.tasks.find((item) => item.id === state.activeCardId) ?? state.server.tasks[0];
  const measurement = useSelector((root: RootState) => selectDraftValue(root, card.id, 'measurement'));
  const finding = useSelector((root: RootState) => selectDraftValue(root, card.id, 'finding'));
  const witnessValue = useSelector((root: RootState) => selectDraftValue(root, card.id, 'witness'));
  const witness = witnessValue === '已确认';
  const [consumable, setConsumable] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [eo, setEo] = useState('EO-2026-1147');
  const [basis, setBasis] = useState('按 AMM 容差分析并经工程部门确认，允许执行复测与系统恢复。');
  const [reauth, setReauth] = useState<{ cardId: string; localId?: string } | null>(null);
  const [peerChange] = usePeerChangeMutation();
  const [bumpRevision] = useBumpCardRevisionMutation();
  const [armFailure] = useArmFailureMutation();

  const overrideInfo = useSelector((root: RootState) => selectOverrideState(root, card.id));
  const measurementConflict = useSelector((root: RootState) => selectPendingFieldChange(root, card.id, 'measurement'))?.status === '差异待决';
  const witnessConflict = useSelector((root: RootState) => selectPendingFieldChange(root, card.id, 'witness'))?.status === '差异待决';
  const findingConflict = useSelector((root: RootState) => selectPendingFieldChange(root, card.id, 'finding'))?.status === '差异待决';

  const toleranceIssue = card.id === 'CARD-03' && Number.parseFloat(measurement) < 2850;
  const dependenciesMet = card.dependencies.every((dependency) => state.server.tasks.find((item) => item.id === dependency)?.status === '已完成');

  const edit = (field: MergeFieldKey, value: string) => dispatch(editDraft({ cardId: card.id, field, value }));

  const openOverride = (target?: { cardId: string; localId?: string }) => {
    setReauth(target ?? null);
    setOverrideOpen(true);
  };

  const submit = async () => {
    if (!dependenciesMet) { dispatch(setConflict(`前置工卡 ${card.dependencies.join('、')} 尚未完成。`)); return; }
    if (!witness) { dispatch(setConflict('关键步骤必须完成见证确认。')); return; }
    if (toleranceIssue && !overrideInfo.active && !overrideInfo.pending) {
      dispatch(setConflict(`测量值超出容差，超差授权必须绑定工卡 ${card.revision}，由授权人员处理后才能完成。`));
      setOverrideOpen(true);
      return;
    }
    dispatch(setConflict(''));
    dispatch(queueComplete(card.id));
    if (!state.offline) await dispatch(syncNow()).then(() => dispatch(pullSnapshot()));
  };

  const simulatePeer = async () => {
    await peerChange({ cardId: card.id, field: 'measurement', value: `${(2800 + Math.floor(Math.random() * 60)).toString()} psi（对端复测）` }).unwrap();
    dispatch(pullSnapshot());
  };
  const simulateBump = async () => {
    await bumpRevision({ cardId: card.id }).unwrap();
    dispatch(pullSnapshot());
  };

  return (
    <div className="page">
      <PageHeading
        eyebrow={`${card.id} / ${card.stage}`}
        title={card.title}
        description={`${card.zone} · 工卡版本 ${card.revision}（修订 #${card.rev}）· 预计 ${card.estimated} 小时`}
        actions={<><Button appearance="secondary" icon={<ArrowSyncRegular />} onClick={() => dispatch(toggleOffline())}>{state.offline ? '恢复在线' : '切换离线'}</Button><Button appearance="primary" icon={<CheckmarkCircleRegular />} onClick={() => void submit()}>完成并提交</Button></>}
      />
      {state.conflictMessage && <MessageBar intent="error" className="top-message"><MessageBarBody><strong>提交被阻断：</strong>{state.conflictMessage}</MessageBarBody></MessageBar>}
      {state.syncError && <MessageBar intent="warning" className="top-message"><MessageBarBody>{state.syncError}</MessageBarBody><Button appearance="secondary" size="small" onClick={() => void dispatch(syncNow())}>重试合并</Button></MessageBar>}
      <div className="execution-grid">
        <section className="panel card-editor">
          <div className="panel-head"><div><h2>工卡执行内容</h2><span>每个字段独立记录修订号与来源，联网后逐字段合并</span></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'brand'}>{card.status} · {card.revision}</Badge></div>
          <div className="procedure-block">
            <h3>施工步骤</h3>
            {['确认飞机断电并设置 DO NOT OPERATE 警告牌。', '连接校准合格的测试设备，按 AMM 29-10-00 执行压力保持测试。', '记录稳定压力值，检查 10 分钟内压降。', '恢复系统构型，目视检查渗漏并上传证据。'].map((step, index) => <label key={step} className="procedure-step"><Checkbox defaultChecked={index < 2} /><span><b>{index + 1}.</b> {step}</span></label>)}
          </div>
          <Divider />
          <div className="form-grid">
            <Field
              label="测量值"
              hint={<span>{card.tolerance}　<TraceChip rev={card.fields.measurement.rev} source={card.fields.measurement.source} time={card.fields.measurement.time} /></span>}
              validationState={toleranceIssue ? 'error' : 'none'}
              validationMessage={toleranceIssue ? `低于最低接受值 2850 psi；授权须绑定 ${card.revision}` : undefined}
            >
              <Input value={measurement} disabled={measurementConflict} onChange={(_, data) => edit('measurement', data.value)} contentBefore={<GaugeRegular />} />
            </Field>
            <Field label="耗材 / 航材"><Input value={consumable} onChange={(_, data) => setConsumable(data.value)} placeholder="输入件号或耗材批次" /></Field>
            <Field label="发现与处置" className="wide-field" hint={<TraceChip rev={card.fields.finding.rev} source={card.fields.finding.source} time={card.fields.finding.time} />}>
              <Textarea value={finding} disabled={findingConflict} onChange={(_, data) => edit('finding', data.value)} resize="vertical" placeholder="正常或填写缺陷、处置措施" />
            </Field>
            <Field label="证据附件" className="wide-field"><div className="upload-zone"><CloudArrowUpRegular /><strong>拖入照片、测试记录或报告</strong><span>已关联 3 个证据 · 支持 JPG / PDF / TXT</span></div></Field>
          </div>
          <label className="witness-check">
            <Checkbox checked={witness} disabled={witnessConflict} onChange={(_, data) => edit('witness', data.checked ? '已确认' : '')} />
            <span><strong>见证人已现场确认</strong><small>要求：{card.witness} · <TraceChip rev={card.fields.witness.rev} source={card.fields.witness.source} time={card.fields.witness.time} conflicted={witnessConflict} /></small></span>
          </label>
        </section>
        <aside className="execution-side">
          {card.status === '待授权' && (
            <section className="panel override-panel">
              <WarningRegular />
              <h3>超差项目等待授权</h3>
              {overrideInfo.active && <p className="override-ok">当前 {card.revision} 的授权有效：{overrideInfo.accepted?.eo}（{overrideInfo.accepted?.actor} · {overrideInfo.accepted?.time}）。</p>}
              {!overrideInfo.active && overrideInfo.pending && <p>授权确认已暂存（绑定 {card.revision}），{state.offline ? '离线中，联网后合并生效' : '等待合并'}；版本若变化需重新确认。</p>}
              {!overrideInfo.active && !overrideInfo.pending && <p>原始测量值保留。授权与工卡 {card.revision} 一起生效；工卡版本一旦变化，旧确认立即作废。</p>}
              {overrideInfo.stale.length > 0 && <p className="override-stale">检测到 {overrideInfo.stale.length} 份绑定旧版本的授权已作废，须在 {card.revision} 重新授权。</p>}
              <Button appearance="primary" onClick={() => openOverride()}>{overrideInfo.active ? '按当前版本重新授权' : '授权处理'}</Button>
            </section>
          )}
          <PendingQueue onReauthorize={(cardId, localId) => openOverride({ cardId, localId })} />
          <section className="panel sim-panel">
            <div className="panel-head"><h2>网络 / 并发演练</h2><ArrowSyncRegular /></div>
            <p>机库内网断开场景：先离线修改并暂存，再模拟对端先提交或工卡改版，恢复在线查看逐字段合并结果。</p>
            <div className="sim-actions">
              <Button size="small" onClick={() => void simulatePeer()}>对端先改 {card.id} 同字段</Button>
              <Button size="small" onClick={() => void simulateBump()}>模拟 {card.id} 工卡升版</Button>
              <Button size="small" onClick={() => void armFailure()}>预置下次写入失败</Button>
            </div>
          </section>
          <section className="panel card-meta"><div className="panel-head"><h2>工卡信息</h2><DocumentBulletListRegular /></div><dl><div><dt>工卡版本</dt><dd>{card.revision} · 修订 #{card.rev}</dd></div><div><dt>容差</dt><dd>{card.tolerance}</dd></div><div><dt>证据要求</dt><dd>{card.evidence}</dd></div><div><dt>前置条件</dt><dd>{card.dependencies.length ? card.dependencies.join('、') : '无'}</dd></div><div><dt>阶段签署</dt><dd>{card.stage}</dd></div></dl></section>
        </aside>
      </div>
      <Dialog open={overrideOpen} onOpenChange={(_, data) => setOverrideOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{reauth ? `工卡升版后重新授权 · ${reauth.cardId}` : `超差授权处理 · ${card.id}`}</DialogTitle>
            <DialogContent>
              授权确认与工卡 <strong>{card.revision}（修订 #{card.rev}）</strong> 绑定后一起生效；工卡版本再变化时本确认自动作废，原始测量值不会被覆盖。
              <Field label="工程指令编号" required className="dialog-field"><Input value={eo} onChange={(_, data) => setEo(data.value)} /></Field>
              <Field label="授权依据" required className="dialog-field"><Textarea value={basis} onChange={(_, data) => setBasis(data.value)} /></Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setOverrideOpen(false)}>取消</Button>
              <Button appearance="primary" onClick={() => {
                const targetCardId = reauth?.cardId ?? card.id;
                if (reauth?.localId) dispatch(rebaseOverrideChange({ localId: reauth.localId, eo, basis }));
                else dispatch(requestOverride({ cardId: targetCardId, eo, basis }));
                setOverrideOpen(false);
                if (!state.offline) void dispatch(syncNow()).then(() => dispatch(pullSnapshot()));
              }}>确认授权</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

function Release() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState('open');
  const blockers = state.server.tasks.filter((card) => card.status !== '已完成' && card.status !== '未开始');
  const allSigned = state.server.signatures.every((item) => item.status === '已签署');
  const pendingCount = state.changes.filter((item) => item.status === '待合并' || item.status === '提交失败' || item.status === '差异待决').length;
  const signaturePending = (stage: string) => state.changes.find((item) => item.kind === 'signature' && item.stage === stage && (item.status === '待合并' || item.status === '提交失败'));
  const signatureConflict = (stage: string) => state.changes.find((item) => item.kind === 'signature' && item.stage === stage && item.status === '差异待决');
  return (
    <div className="page">
      <PageHeading
        eyebrow="RELEASE REVIEW / B-7891"
        title="放行审阅"
        description="超差授权按工卡版本生效；字段修订全部合并、阶段签署到位后才能锁定。"
        actions={<Button appearance="primary" icon={<LockClosedRegular />} disabled={!allSigned || blockers.some((card) => card.status === '待授权') || pendingCount > 0} onClick={() => dispatch(releasePackage())}>{state.released ? '工作包已锁定' : '锁定并放行'}</Button>}
      />
      {state.released && <MessageBar intent="success" className="top-message"><MessageBarBody>工作包已锁定，形成只读放行基线并纳入审计记录。</MessageBarBody></MessageBar>}
      {pendingCount > 0 && <MessageBar intent="warning" className="top-message"><MessageBarBody>还有 <strong>{pendingCount}</strong> 项字段修订未完成合并（含差异待决），放行门禁暂不开放。</MessageBarBody></MessageBar>}
      <div className="release-grid">
        <section className="panel release-main">
          <TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}><Tab value="open">未关闭项目 <Badge>{blockers.length}</Badge></Tab><Tab value="repeat">重复缺陷 <Badge>2</Badge></Tab><Tab value="evidence">关键证据 <Badge>12</Badge></Tab></TabList>
          <div className="tab-body">
            {tab === 'open' && blockers.map((card) => {
              const override = state.server.overrides.find((item) => item.cardId === card.id && item.cardRev === card.rev);
              return (
                <div className="review-item" key={card.id}>
                  <span className={`risk-icon ${card.status === '待授权' ? 'danger' : ''}`}><AlertRegular /></span>
                  <div><strong>{card.id} · {card.title}（{card.revision}）</strong><p>{card.fields.finding.value || '工卡正在执行，完成后需由放行人员复核。'}</p><small>{card.zone} · 要求证据 {card.evidence}{card.status === '待授权' && (override ? ` · 超差授权 ${override.eo} 已绑定 ${card.revision}` : ' · 缺少匹配当前版本的超差授权')}</small></div>
                  <Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'warning'}>{card.status}</Badge>
                </div>
              );
            })}
            {tab === 'repeat' && <><div className="review-item"><span className="risk-icon danger"><HistoryRegular /></span><div><strong>液压系统压力偏低 · 第 3 次记录</strong><p>2026-08-16、09-02、09-29 均在系统 A 出现压力低于目标值。</p><small>建议移交可靠性分析，并关联历史排故记录。</small></div><Badge appearance="tint" color="danger">关键</Badge></div><div className="review-item"><span className="risk-icon"><HistoryRegular /></span><div><strong>APU 启动时间延长</strong><p>最近两次航线记录均略高于机队均值。</p><small>非放行阻塞项，建议后续监控。</small></div><Badge appearance="tint" color="warning">观察</Badge></div></>}
            {tab === 'evidence' && <div className="evidence-grid">{['液压系统测试记录.pdf', '发动机孔探照片_01.jpg', 'AD 执行签署页.pdf', '时寿件履历截图.png', '超差工程指令.pdf', '见证人签字单.pdf'].map((file) => <div className="evidence-tile" key={file}><DocumentBulletListRegular /><strong>{file}</strong><span>已绑定工卡 · 已核验</span></div>)}</div>}
          </div>
        </section>
        <aside className="release-side">
          <section className="panel signoff-card"><div className="panel-head"><h2>分阶段签字</h2><span>{state.server.signatures.filter((item) => item.status === '已签署').length} / 4</span></div>
            {state.server.signatures.map((item) => {
              const pending = signaturePending(item.stage);
              const conflict = signatureConflict(item.stage);
              return (
                <div className="signoff-row" key={item.stage}>
                  <div><span>{item.stage}签署 {item.status === '已签署' && <em>#{item.rev}</em>}</span><strong>{item.actor || (pending?.value as string) || '待指定'}</strong><small>{item.time}{pending ? ' · 本地已签，等待联网合并' : ''}{conflict ? ' · 对端已先签署，差异待决' : ''}</small></div>
                  {item.status === '已签署' ? <Badge appearance="tint" color="success">已签署</Badge>
                    : pending ? <Badge appearance="tint" color="warning">待合并</Badge>
                    : <Button size="small" appearance="primary" onClick={() => dispatch(signStage({ stage: item.stage, actor: STAGE_ACTOR[item.stage] ?? `${item.stage}负责人` }))}>签署</Button>}
                </div>
              );
            })}
            {state.changes.some((item) => item.kind === 'signature' && item.status === '差异待决') && (
              <div className="signoff-conflict">
                {state.changes.filter((item) => item.kind === 'signature' && item.status === '差异待决').map((change) => (
                  <div key={change.localId} className="conflict-inline">
                    <strong>{change.stage}签署冲突</strong>
                    <small>先到方：{change.conflict?.serverValue}（#{change.conflict?.serverRev}）；本方：{change.conflict?.localValue}</small>
                    <Button size="small" appearance="primary" onClick={() => dispatch(resolveFieldConflict({ localId: change.localId, decision: 'theirs' }))}>查看差异后采用先到方</Button>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="panel release-gate-card"><LockClosedRegular /><h3>放行门禁</h3>
            <label><Checkbox checked={!state.server.tasks.some((card) => card.status === '待授权' && !state.server.overrides.some((o) => o.cardId === card.id && o.cardRev === card.rev))} readOnly /> 超差授权与当前工卡版本一致</label>
            <label><Checkbox checked={pendingCount === 0} readOnly /> 字段修订已全部逐字段合并（{pendingCount} 项待处理）</label>
            <label><Checkbox checked={allSigned} readOnly /> 四个阶段均完成电子签署</label>
            <label><Checkbox checked={state.server.tasks.filter((card) => card.status === '已完成').length >= 6} readOnly /> 关键工卡完成率 ≥ 75%</label>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Audit() {
  const state = useSelector((root: RootState) => root.maintenance);
  const [selected, setSelected] = useState('R7');
  const downloadAudit = () => {
    const csv = ['时间,操作者,动作,说明', ...state.audit.map((item) => [item.time, item.actor, item.action, item.detail].join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'B7891-48A-audit.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const diffs = useMemo(() => [
    { card: 'CARD-03', field: '容差', from: '≥ 2800 psi / 10 min', to: '≥ 2850 psi / 10 min', reason: 'AMM 临时修订 TR-114' },
    { card: 'CARD-07', field: '依赖', from: 'CARD-02', to: 'CARD-03', reason: '试车前置条件调整' },
    { card: 'CARD-08', field: '证据', from: '近 2 次记录', to: '近 3 次记录', reason: '可靠性复核要求' }
  ], []);
  return (
    <div className="page">
      <PageHeading eyebrow="AUDIT / FIELD REVISIONS" title="审计与修订溯源" description="测量值、发现项、见证确认、阶段签署均带修订号与来源；超差授权随工卡版本生效或作废。" actions={<Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={downloadAudit}>导出审计记录</Button>} />
      <div className="audit-grid">
        <section className="panel diff-panel">
          <div className="panel-head"><div><h2>字段修订溯源</h2><span>每个字段独立修订号，合并不互相覆盖</span></div><select value={selected} onChange={(event) => setSelected(event.target.value)}><option>R7</option><option>R6</option><option>R5</option></select></div>
          <div className="trace-table">
            <div className="trace-head"><span>工卡</span><span>字段</span><span>当前值</span><span>修订 / 来源</span></div>
            {state.server.tasks.flatMap((card) => (Object.keys(card.fields) as MergeFieldKey[]).map((key) => {
              const trace = card.fields[key];
              if (!trace.value) return null;
              return <div className="trace-row" key={`${card.id}-${key}`}><strong>{card.id}<em>{card.revision}</em></strong><span>{FIELD_LABEL[key]}</span><span className="trace-val">{trace.value}</span><small>#{trace.rev} · {trace.source} · {trace.time}</small></div>;
            }))}
            {state.server.overrides.map((item) => <div className="trace-row override" key={item.id}><strong>{item.cardId}<em>{item.revision}</em></strong><span>超差授权</span><span className="trace-val">{item.eo}</span><small>绑定修订 #{item.cardRev} · {item.actor} · {item.time}</small></div>)}
          </div>
          <Divider />
          <div className="diff-table"><div className="diff-head"><span>工卡</span><span>字段</span><span>原值</span><span>新值 / 原因</span></div>{diffs.map((diff) => <div className="diff-row" key={`${diff.card}-${diff.field}`}><strong>{diff.card}</strong><span>{diff.field}</span><del>{diff.from}</del><div><ins>{diff.to}</ins><small>{diff.reason}</small></div></div>)}</div>
        </section>
        <section className="panel audit-panel"><div className="panel-head"><div><h2>完整审计时间线</h2><span>{state.audit.length} 条记录 · 上次同步 {state.lastSync}</span></div><HistoryRegular /></div>{state.audit.map((item, index) => <div className="audit-row" key={`${item.time}-${index}`}><span className="timeline-dot" /><div><strong>{item.action}</strong><p>{item.detail}</p><small>{item.time} · {item.actor}</small></div></div>)}</section>
      </div>
    </div>
  );
}

function NotFound() {
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <BrowserRouter>
        <Shell><Routes><Route path="/" element={<Overview />} /><Route path="/execution" element={<Execution />} /><Route path="/release" element={<Release />} /><Route path="/audit" element={<Audit />} /><Route path="*" element={<NotFound />} /></Routes></Shell>
      </BrowserRouter>
    </FluentProvider>
  );
}
