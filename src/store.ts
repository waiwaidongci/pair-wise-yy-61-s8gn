import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  buildInitialSnapshot,
  LOCAL_DEVICE,
  LOCAL_ORIGIN,
  maintenanceApi,
  type ChangeDTO,
  type ChangeOutcome,
  type MergeFieldKey,
  type PackageSnapshot
} from './api';

export type StageSignatureTrace = {
  stage: string;
  status: '待签署' | '已签署';
  actor: string;
  rev: number;
  source: string;
  device: string;
  time: string;
};

export type ChangeStatus = '待合并' | '已合并' | '差异待决' | '授权已作废' | '被拒绝' | '提交失败';

export type PendingChange = ChangeDTO & {
  localId: string;
  label: string;
  status: ChangeStatus;
  reason?: string;
  conflict?: ChangeOutcome['conflict'];
  createdAt: string;
  updatedAt: string;
};

export type Drafts = Record<string, Partial<Record<MergeFieldKey, string>>>;

export type AuditEntry = { time: string; actor: string; action: string; detail: string };

type MaintenanceState = {
  schemaVersion: number;
  server: PackageSnapshot;
  drafts: Drafts;
  changes: PendingChange[];
  activeCardId: string;
  offline: boolean;
  syncing: boolean;
  lastSync: string;
  syncError: string;
  conflictMessage: string;
  released: boolean;
  audit: AuditEntry[];
};

const FIELD_LABEL: Record<MergeFieldKey, string> = {
  measurement: '测量值',
  finding: '发现项',
  witness: '见证确认'
};

const nowHM = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

const newToken = () => `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const cloneSnapshot = (snapshot: PackageSnapshot): PackageSnapshot => ({
  ...snapshot,
  tasks: snapshot.tasks.map((card) => ({ ...card, dependencies: [...card.dependencies], fields: { ...card.fields } })),
  signatures: snapshot.signatures.map((item) => ({ ...item })),
  overrides: snapshot.overrides.map((item) => ({ ...item }))
});

/* 旧草稿没有修订号：按当前服务器版本补齐修订号与来源，作为待合并改动升级 */
function migrateLegacy(saved: any): MaintenanceState {
  const snapshot = buildInitialSnapshot();
  const drafts: Drafts = {};
  const changes: PendingChange[] = [];
  const time = nowHM();
  for (const oldCard of saved.cards ?? []) {
    const card = snapshot.tasks.find((item) => item.id === oldCard.id);
    if (!card) continue;
    (['measurement', 'finding'] as MergeFieldKey[]).forEach((fieldKey) => {
      const legacyValue = String(oldCard[fieldKey] ?? '').trim();
      const baseValue = card.fields[fieldKey].value;
      if (legacyValue && legacyValue !== baseValue) {
        drafts[oldCard.id] = { ...drafts[oldCard.id], [fieldKey]: legacyValue };
        changes.push({
          localId: newToken(),
          token: newToken(),
          kind: 'field',
          cardId: card.id,
          field: fieldKey,
          value: legacyValue,
          baseValue,
          baseRev: snapshot.serverRevision,
          origin: `旧草稿升级 · 按当前版本 ${card.revision} 补修订号 · 宋杰 · 机械`,
          device: LOCAL_DEVICE,
          label: `${card.id} ${FIELD_LABEL[fieldKey]}（旧草稿→${card.revision}）`,
          status: '待合并',
          createdAt: time,
          updatedAt: time
        });
      }
    });
  }
  return {
    schemaVersion: 2,
    server: snapshot,
    drafts,
    changes,
    activeCardId: typeof saved.activeCardId === 'string' ? saved.activeCardId : 'CARD-03',
    offline: false,
    syncing: false,
    lastSync: '尚未同步',
    syncError: changes.length ? `检测到 ${changes.length} 条无修订号旧草稿，已按当前版本升级，联网后合并。` : '',
    conflictMessage: '',
    released: false,
    audit: [
      { time, actor: '系统', action: '旧草稿升级', detail: changes.length ? `${changes.length} 条离线草稿补齐当前修订号，等待合并` : '旧草稿无需升级' },
      ...(Array.isArray(saved.audit) ? saved.audit.slice(0, 5) : [])
    ]
  };
}

function freshState(): MaintenanceState {
  return {
    schemaVersion: 2,
    server: buildInitialSnapshot(),
    drafts: {},
    changes: [],
    activeCardId: 'CARD-03',
    offline: false,
    syncing: false,
    lastSync: '尚未同步',
    syncError: '',
    conflictMessage: '',
    released: false,
    audit: [
      { time: '08:54', actor: '赵明', action: '完成工卡', detail: 'CARD-01 间隙测量 1.62 mm' },
      { time: '09:05', actor: '宋杰', action: '提交测量', detail: 'CARD-03 压力 2762 psi，低于容差' },
      { time: '09:20', actor: '系统', action: '阻断', detail: 'CARD-03 等待授权处理' }
    ]
  };
}

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy61-work-package') : null;
const parsed = raw ? JSON.parse(raw) : null;
const initialState: MaintenanceState = parsed
  ? parsed.schemaVersion === 2
    ? parsed
    : migrateLegacy(parsed)
  : freshState();

const ACTIVE_CHANGE_STATUSES: ChangeStatus[] = ['待合并', '提交失败', '差异待决'];

const activeChangeForField = (state: MaintenanceState, cardId: string, fieldKey: MergeFieldKey) =>
  state.changes.find(
    (item) => item.kind === 'field' && item.cardId === cardId && item.field === fieldKey && ACTIVE_CHANGE_STATUSES.includes(item.status)
  );

const slice = createSlice({
  name: 'maintenance',
  initialState,
  reducers: {    selectCard(state, action: PayloadAction<string>) {
      state.activeCardId = action.payload;
      state.conflictMessage = '';
    },
    toggleOffline(state) {
      state.offline = !state.offline;
      state.audit.unshift({
        time: nowHM(),
        actor: '系统',
        action: state.offline ? '进入离线' : '网络恢复',
        detail: state.offline ? '机库内网断开，改动只写本地草稿与待合并队列' : '链路恢复，可以逐字段合并待处理改动'
      });
    },
    setConflict(state, action: PayloadAction<string>) {
      state.conflictMessage = action.payload;
    },
    /* 本地暂存（离线可写）：记录工作值，并以“当前采用的服务器值”为合并基线 */
    editDraft(state, action: PayloadAction<{ cardId: string; field: MergeFieldKey; value: string }>) {
      const { cardId, field, value } = action.payload;
      const card = state.server.tasks.find((item) => item.id === cardId);
      if (!card) return;
      const serverValue = card.fields[field].value;
      if (!state.drafts[cardId]) state.drafts[cardId] = {};
      if (value === serverValue) {
        delete state.drafts[cardId][field];
      } else {
        state.drafts[cardId][field] = value;
      }

      const existing = activeChangeForField(state, cardId, field);
      if (value === serverValue && existing && existing.status !== '差异待决') {
        /* 改回服务器原值：撤销本地待合并改动 */
        existing.status = '已合并';
        existing.reason = '本地值与服务器一致，无需合并';
        existing.updatedAt = nowHM();
        delete state.drafts[cardId][field];
        return;
      }
      const time = nowHM();
      if (existing) {
        existing.value = value;
        existing.updatedAt = time;
        existing.status = existing.status === '提交失败' ? '待合并' : existing.status;
        existing.label = `${cardId} ${FIELD_LABEL[field]}（基于 ${card.revision} #${existing.baseRev}）`;
      } else if (value !== serverValue) {
        state.changes.push({
          localId: newToken(),
          token: newToken(),
          kind: 'field',
          cardId,
          field,
          value,
          baseValue: serverValue,
          baseRev: card.fields[field].rev,
          origin: LOCAL_ORIGIN,
          device: LOCAL_DEVICE,
          label: `${cardId} ${FIELD_LABEL[field]}（基于 ${card.revision} #${card.fields[field].rev}）`,
          status: '待合并',
          createdAt: time,
          updatedAt: time
        });
      }
    },
    /* 超差授权：必须绑定授权时的工卡修订号，版本一变即失效 */
    requestOverride(state, action: PayloadAction<{ cardId: string; eo: string; basis: string }>) {
      const { cardId, eo, basis } = action.payload;
      const card = state.server.tasks.find((item) => item.id === cardId);
      if (!card || card.status !== '待授权') return;
      const existing = state.changes.find(
        (item) => item.kind === 'override' && item.cardId === cardId && (item.status === '待合并' || item.status === '提交失败')
      );
      const time = nowHM();
      if (existing) {
        /* 已有待合并授权：只更新内容，不重复堆叠 */
        existing.eo = eo;
        existing.basis = basis;
        existing.cardRev = card.rev;
        existing.updatedAt = time;
        existing.label = `${cardId} 超差授权（绑定 ${card.revision} · ${eo}）`;
        state.audit.unshift({ time, actor: '放行授权人 · 周正', action: '超差授权', detail: `${cardId} 更新待合并授权，仍与工卡 ${card.revision} 绑定` });
        return;
      }
      state.changes.push({
        localId: newToken(),
        token: newToken(),
        kind: 'override',
        cardId,
        cardRev: card.rev,
        baseRev: state.server.serverRevision,
        eo,
        basis,
        origin: LOCAL_ORIGIN,
        device: LOCAL_DEVICE,
        label: `${cardId} 超差授权（绑定 ${card.revision} · ${eo}）`,
        status: '待合并',
        createdAt: time,
        updatedAt: time
      });
      state.audit.unshift({ time, actor: '放行授权人 · 周正', action: '超差授权', detail: `${cardId} 按 ${eo} 授权继续，确认与工卡 ${card.revision} 绑定` });
    },
    signStage(state, action: PayloadAction<{ stage: string; actor: string }>) {
      const { stage, actor } = action.payload;
      const sig = state.server.signatures.find((item) => item.stage === stage);
      if (!sig) return;
      const pending = state.changes.find((item) => item.kind === 'signature' && item.stage === stage && ACTIVE_CHANGE_STATUSES.includes(item.status));
      const time = nowHM();
      if (pending) {
        pending.value = actor;
        pending.updatedAt = time;
      } else {
        state.changes.push({
          localId: newToken(),
          token: newToken(),
          kind: 'signature',
          stage,
          value: actor,
          baseValue: sig.actor,
          baseRev: sig.rev,
          origin: LOCAL_ORIGIN,
          device: LOCAL_DEVICE,
          label: `${stage}阶段签署（${actor}）`,
          status: '待合并',
          createdAt: time,
          updatedAt: time
        });
      }
      state.audit.unshift({ time, actor, action: '阶段签署', detail: `${stage}阶段签署已暂存，等待联网合并` });
    },
    /* 完成工卡也进入待合并队列；服务端校验测量值、见证及超差授权版本是否仍匹配 */
    queueComplete(state, action: PayloadAction<string>) {
      const cardId = action.payload;
      const card = state.server.tasks.find((item) => item.id === cardId);
      if (!card) return;
      const existing = state.changes.find((item) => item.kind === 'complete' && item.cardId === cardId && ACTIVE_CHANGE_STATUSES.includes(item.status));
      if (existing) return;
      const time = nowHM();
      state.changes.push({
        localId: newToken(),
        token: newToken(),
        kind: 'complete',
        cardId,
        cardRev: card.rev,
        baseRev: state.server.serverRevision,
        origin: LOCAL_ORIGIN,
        device: LOCAL_DEVICE,
        label: `${cardId} 完成工卡（基于 ${card.revision}）`,
        status: '待合并',
        createdAt: time,
        updatedAt: time
      });
      state.audit.unshift({ time, actor: '宋杰 · 机械', action: '提交完成', detail: `${cardId} 完成请求已入队，等待服务器按 ${card.revision} 校验` });
    },
    markSyncing(state, action: PayloadAction<boolean>) {
      state.syncing = action.payload;
    },
    setSyncError(state, action: PayloadAction<string>) {
      state.syncError = action.payload;
    },
    /* 写入失败：原草稿和待合并改动原样保留，只标记失败，等待同 token 重试 */
    markSyncFailed(state, action: PayloadAction<string>) {
      state.syncing = false;
      state.syncError = action.payload;
      for (const change of state.changes) {
        if (change.status === '待合并') change.status = '提交失败';
      }
      state.audit.unshift({ time: nowHM(), actor: '系统', action: '写入失败', detail: '服务器未接受改动，原草稿与待合并队列完整保留，可重试' });
    },
    /* 采用服务器快照：未决字段保留本地草稿，其余以服务器为准，绝不盖掉先到数据 */
    applySnapshot(state, action: PayloadAction<{ snapshot: PackageSnapshot; outcomes?: ChangeOutcome[] }>) {
      const { snapshot, outcomes } = action.payload;
      const outcomeByToken = new Map((outcomes ?? []).map((item) => [item.token, item]));
      state.server = cloneSnapshot(snapshot);

      for (const change of state.changes) {
        const outcome = outcomeByToken.get(change.token);
        if (!outcome) continue;
        change.updatedAt = nowHM();
        if (outcome.result === 'accepted' || outcome.result === 'noop') {
          change.status = '已合并';
          change.reason = outcome.result === 'noop' ? '服务器已有相同值' : undefined;
          change.conflict = undefined;
        } else if (outcome.result === 'conflict') {
          change.status = '差异待决';
          change.conflict = outcome.conflict;
          change.reason = '先到方已修改同字段，后到方需查看差异后决定';
        } else if (outcome.result === 'staleOverride') {
          change.status = '授权已作废';
          change.reason = outcome.reason;
        } else if (outcome.result === 'rejected') {
          change.status = '被拒绝';
          change.reason = outcome.reason;
        }
      }

      /* 快照拉取（非本轮回执）时，已接受的旧授权若不再匹配当前工卡版本，也要显式作废 */
      if (!outcomes) {
        for (const change of state.changes) {
          if (change.kind !== 'override' || change.status !== '已合并' || !change.cardId) continue;
          const acceptedRecord = snapshot.overrides.find((item) => item.id === change.token);
          const card = snapshot.tasks.find((item) => item.id === change.cardId);
          if (acceptedRecord && card && acceptedRecord.cardRev !== card.rev) {
            change.status = '授权已作废';
            change.reason = `授权绑定 R${change.cardRev}，工卡已升级到 ${card.revision}，旧确认自动作废，须重新授权`;
            change.updatedAt = nowHM();
          }
        }
      }

      /* 清理已被服务器接受的本地草稿；仍在差异待决的草稿必须保留 */
      for (const card of snapshot.tasks) {
        for (const fieldKey of ['measurement', 'finding', 'witness'] as MergeFieldKey[]) {
          const pending = activeChangeForField(state, card.id, fieldKey);
          const draft = state.drafts[card.id]?.[fieldKey];
          if (draft === undefined) continue;
          if (!pending || draft === card.fields[fieldKey].value) {
            delete state.drafts[card.id]![fieldKey];
          }
        }
      }

      state.syncing = false;
      state.syncError = '';
      state.lastSync = nowHM();
      const accepted = (outcomes ?? []).filter((item) => item.result === 'accepted').length;
      const conflicts = (outcomes ?? []).filter((item) => item.result === 'conflict').length;
      if (outcomes && outcomes.length) {
        state.audit.unshift({
          time: state.lastSync,
          actor: '系统',
          action: '逐字段合并',
          detail: `本轮 ${outcomes.length} 条：接受 ${accepted}、冲突待决 ${conflicts}，先到方数据未被覆盖`
        });
      }
    },
    /* 后到方看完差异后的决定：采用服务器 / 保留我的（以服务器现值为新基线再提） / 改用新值 */
    resolveFieldConflict(state, action: PayloadAction<{ localId: string; decision: 'theirs' | 'mine' | 'custom'; customValue?: string }>) {
      const { localId, decision, customValue } = action.payload;
      const change = state.changes.find((item) => item.localId === localId);
      if (!change || change.status !== '差异待决' || change.kind !== 'field' || !change.conflict || !change.cardId || !change.field) return;
      const card = state.server.tasks.find((item) => item.id === change.cardId);
      if (!card) return;
      const fieldKey = change.field;

      if (decision === 'theirs') {
        change.status = '已合并';
        change.reason = '查看差异后采用先到方（服务器）数据';
        change.conflict = undefined;
        if (state.drafts[change.cardId]?.[fieldKey] !== undefined) delete state.drafts[change.cardId]![fieldKey];
        state.audit.unshift({ time: nowHM(), actor: '当前用户', action: '差异处置', detail: `${change.cardId} ${FIELD_LABEL[fieldKey]} 采用先到方数据，未覆盖对方` });
        return;
      }

      const value = decision === 'custom' ? (customValue ?? '') : change.value ?? '';
      /* 以服务器当前值为新基线、换新令牌再提交：只提交一次，旧令牌不再复用 */
      change.token = newToken();
      change.value = value;
      change.baseValue = change.conflict.serverValue;
      change.baseRev = change.conflict.serverRev;
      change.status = '待合并';
      change.conflict = undefined;
      change.reason = undefined;
      change.updatedAt = nowHM();
      change.label = `${change.cardId} ${FIELD_LABEL[fieldKey]}（差异复核后基于 ${card.revision} #${change.baseRev}）`;
      if (!state.drafts[change.cardId]) state.drafts[change.cardId] = {};
      state.drafts[change.cardId][fieldKey] = value;
      state.audit.unshift({
        time: nowHM(),
        actor: '当前用户',
        action: '差异处置',
        detail: `${change.cardId} ${FIELD_LABEL[fieldKey]} 已查看差异后保留本方值，以先到方修订 #${change.baseRev} 为新基线`
      });
    },
    /* 工卡改版后，作废的授权需要在新版本重新确认 */
    rebaseOverrideChange(state, action: PayloadAction<{ localId: string; eo: string; basis: string }>) {
      const change = state.changes.find((item) => item.localId === action.payload.localId);
      if (!change || change.kind !== 'override' || !change.cardId) return;
      const card = state.server.tasks.find((item) => item.id === change.cardId);
      if (!card) return;
      change.token = newToken();
      change.cardRev = card.rev;
      change.baseRev = state.server.serverRevision;
      change.eo = action.payload.eo;
      change.basis = action.payload.basis;
      change.status = '待合并';
      change.reason = undefined;
      change.label = `${card.id} 超差授权（重新绑定 ${card.revision} · ${action.payload.eo}）`;
      change.updatedAt = nowHM();
    },
    dismissChange(state, action: PayloadAction<string>) {
      const change = state.changes.find((item) => item.localId === action.payload);
      if (change && (change.status === '被拒绝' || change.status === '授权已作废' || change.status === '已合并')) {
        state.changes = state.changes.filter((item) => item.localId !== action.payload);
      }
    },
    releasePackage(state) {
      const hasBlockers = state.server.tasks.some((card) => {
        if (card.status !== '待授权') return false;
        return !state.server.overrides.some((item) => item.cardId === card.id && item.cardRev === card.rev);
      });
      const pendingBlocking = state.changes.some((item) => item.status === '待合并' || item.status === '提交失败' || item.status === '差异待决');
      const allSigned = state.server.signatures.every((item) => item.status === '已签署');
      if (!hasBlockers && !pendingBlocking && allSigned) {
        state.released = true;
        state.audit.unshift({ time: nowHM(), actor: '质量经理', action: '锁定放行', detail: '工作包已锁定并形成放行基线' });
      }
    }
  }
});

export const {
  selectCard,
  toggleOffline,
  setConflict,
  editDraft,
  requestOverride,
  queueComplete,
  signStage,
  markSyncing,
  setSyncError,
  markSyncFailed,
  applySnapshot,
  resolveFieldConflict,
  rebaseOverrideChange,
  dismissChange,
  releasePackage
} = slice.actions;

/* 联网后逐字段合并：只发送待合并/失败的改动；重试沿用原 token，服务器幂等去重，逻辑上只提交一次 */
export function syncNow() {
  return async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState().maintenance;
    if (state.syncing) return;
    if (state.offline) {
      dispatch(setSyncError('仍处离线模式：改动已保留在本地草稿与待合并队列，网络恢复后自动合并。'));
      return;
    }
    const queue = state.changes.filter((item) => item.status === '待合并' || item.status === '提交失败');
    if (queue.length === 0) {
      dispatch(setSyncError(''));
      return;
    }
    dispatch(markSyncing(true));
    const payload = queue.map(({ localId, label, status, reason, conflict, createdAt, updatedAt, ...dto }) => dto);
    try {
      const result = await dispatch(maintenanceApi.endpoints.syncChanges.initiate({ changes: payload })).unwrap();
      dispatch(applySnapshot({ snapshot: result.snapshot, outcomes: result.outcomes }));
    } catch (error: any) {
      /* 写入失败：不清空草稿、不清队列，下一次重试仍是同一批 token */
      dispatch(markSyncFailed(error?.data?.message ?? '写入失败：服务器未接受改动，原草稿与待合并改动已保留。'));
    }
  };
}

/* 拉取对端改动 / 工卡改版：只采用服务器快照，本地未决草稿照旧保留到合并时比对 */
export function pullSnapshot() {
  return async (dispatch: AppDispatch) => {
    try {
      const snapshot = await dispatch(maintenanceApi.endpoints.getWorkPackage.initiate(undefined, { forceRefetch: true })).unwrap();
      dispatch(applySnapshot({ snapshot }));
    } catch {
      /* 离线时静默：继续使用本地基线 */
    }
  };
}

export const store = configureStore({
  reducer: { maintenance: slice.reducer, [maintenanceApi.reducerPath]: maintenanceApi.reducer },
  middleware: (getDefault) => getDefault().concat(maintenanceApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('yy61-work-package', JSON.stringify(store.getState().maintenance));
});

/* ---------- 选择器 ---------- */
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const selectCardById = (state: RootState, cardId: string) => state.maintenance.server.tasks.find((item) => item.id === cardId);

export const selectDraftValue = (state: RootState, cardId: string, fieldKey: MergeFieldKey): string => {
  const draft = state.maintenance.drafts[cardId]?.[fieldKey];
  if (draft !== undefined) return draft;
  return state.maintenance.server.tasks.find((item) => item.id === cardId)?.fields[fieldKey].value ?? '';
};

export const selectPendingFieldChange = (state: RootState, cardId: string, fieldKey: MergeFieldKey) =>
  state.maintenance.changes.find(
    (item) => item.kind === 'field' && item.cardId === cardId && item.field === fieldKey && ACTIVE_CHANGE_STATUSES.includes(item.status)
  );

export const selectOverrideState = (state: RootState, cardId: string) => {
  const card = state.maintenance.server.tasks.find((item) => item.id === cardId);
  if (!card) return { active: false, pending: undefined as PendingChange | undefined, stale: [] as PendingChange[] };
  const accepted = state.maintenance.server.overrides.find((item) => item.cardId === cardId && item.cardRev === card.rev);
  const pending = state.maintenance.changes.find(
    (item) => item.kind === 'override' && item.cardId === cardId && (item.status === '待合并' || item.status === '提交失败')
  );
  const stale = state.maintenance.changes.filter((item) => item.kind === 'override' && item.cardId === cardId && item.status === '授权已作废');
  return { active: Boolean(accepted), accepted, pending, stale };
};
