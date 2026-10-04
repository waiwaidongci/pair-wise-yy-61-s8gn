import { configureStore, createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import {
  maintenanceApi,
  type EditableField,
  type FieldConflict,
  type FieldSource,
  type OverrideRecord,
  type ServerCard,
  type ServerSignature,
  type Versioned,
  type WorkPackage
} from './api';

export type Card = ServerCard;
export type StageSignature = ServerSignature;

export type AuditEntry = { time: string; actor: string; action: string; detail: string };

export type PendingField = { value: string | boolean; baseRevision: number };

export type PendingChange = {
  clientId: string;
  cardId: string;
  fields: Partial<Record<EditableField, PendingField>>;
  override?: OverrideRecord;
  createdAt: string;
  retries: number;
};

export type PendingSignature = {
  clientId: string;
  stage: string;
  actor: string;
  baseRevision: number;
  createdAt: string;
  retries: number;
};

export type ConflictChoice = 'local' | 'server';

export type ConflictEntry = {
  cardId: string;
  field: EditableField | 'signature';
  label: string;
  baseRevision: number;
  serverRevision: number;
  localValue: unknown;
  serverValue: unknown;
  choice: ConflictChoice;
};

export type SyncState = 'synced' | 'offline' | 'pending' | 'merging' | 'conflict' | 'error';

type MaintenanceState = {
  cards: Card[];
  signatures: StageSignature[];
  serverRevision: number;
  offline: boolean;
  syncState: SyncState;
  pending: PendingChange[];
  pendingSignatures: PendingSignature[];
  conflicts: ConflictEntry[];
  lastError: string;
  lastSaved: string;
  activeCardId: string;
  conflictMessage: string;
  released: boolean;
  audit: AuditEntry[];
};

const nowIso = () => new Date().toISOString();
const nowTime = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

const fieldLabels: Record<EditableField, string> = {
  measurement: '测量值',
  finding: '发现项',
  witnessConfirmed: '见证确认'
};

const v = <T,>(value: T, revision: number): Versioned<T> => ({ value, revision, source: 'server', at: '2026-09-29T09:00:00+08:00' });

const seedCards: Card[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', revisionText: 'R7', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', stage: '机械签署', status: '已完成', measurement: v('1.62 mm', 7), finding: v('正常', 7), witnessConfirmed: v(true, 7), override: null },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', revisionText: 'R7', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', stage: '发动机签署', status: '执行中', measurement: v('', 7), finding: v('', 7), witnessConfirmed: v(false, 7), override: null },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', revisionText: 'R6', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', stage: '系统签署', status: '待授权', measurement: v('2762 psi', 7), finding: v('低于容差，等待授权', 7), witnessConfirmed: v(false, 7), override: null },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', revisionText: 'R7', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', stage: '适航签署', status: '已完成', measurement: v('剩余 836 循环', 7), finding: v('正常', 7), witnessConfirmed: v(true, 7), override: null },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', revisionText: 'R7', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', stage: '适航签署', status: '未开始', measurement: v('', 7), finding: v('', 7), witnessConfirmed: v(false, 7), override: null },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', revisionText: 'R7', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', stage: '客舱签署', status: '未开始', measurement: v('', 7), finding: v('', 7), witnessConfirmed: v(false, 7), override: null },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', revisionText: 'R5', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', stage: '动力签署', status: '未开始', measurement: v('', 7), finding: v('', 7), witnessConfirmed: v(false, 7), override: null },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', revisionText: 'R7', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', stage: '放行签署', status: '执行中', measurement: v('发现 2 次压力偏低', 7), finding: v('移交可靠性分析', 7), witnessConfirmed: v(false, 7), override: null }
];

const seedSignatures: StageSignature[] = [
  { stage: '机械', status: '已签署', actor: '赵明 · 机械师', time: '09:18', revision: 7, source: 'server' },
  { stage: '系统', status: '待签署', actor: '待指定', time: '-', revision: 7, source: 'server' },
  { stage: '动力', status: '待签署', actor: '待指定', time: '-', revision: 7, source: 'server' },
  { stage: '放行', status: '待签署', actor: '质量经理', time: '-', revision: 7, source: 'server' }
];

function isVersioned(value: unknown): value is Versioned<unknown> {
  return !!value && typeof value === 'object' && 'revision' in value && 'source' in value;
}

/**
 * 旧草稿迁移：没有修订号的草稿一律按当前服务器版本升级，
 * 来源标记为 server（视为当前版本基线），保证后续逐字段合并有基线可比。
 */
function migrate(saved: any): MaintenanceState {
  const serverRevision = typeof saved?.serverVersion === 'number' ? saved.serverVersion : 7;
  const now = saved?.lastSaved ?? nowTime();
  const rawCards: any[] = Array.isArray(saved?.cards) && saved.cards.length ? saved.cards : seedCards;

  const cards: Card[] = rawCards.map((raw) => {
    if (isVersioned(raw?.measurement) && isVersioned(raw?.finding) && isVersioned(raw?.witnessConfirmed)) {
      return raw as Card;
    }
    return {
      id: raw.id,
      title: raw.title,
      zone: raw.zone ?? '',
      revisionText: raw.revisionText ?? raw.revision ?? 'R7',
      estimated: raw.estimated ?? 0,
      dependencies: raw.dependencies ?? [],
      tolerance: raw.tolerance ?? '',
      evidence: raw.evidence ?? '',
      witness: raw.witness ?? '',
      stage: raw.stage ?? '',
      status: raw.status ?? '未开始',
      measurement: isVersioned(raw.measurement) ? raw.measurement : { value: raw.measurement ?? '', revision: serverRevision, source: 'server' as FieldSource, at: now },
      finding: isVersioned(raw.finding) ? raw.finding : { value: raw.finding ?? '', revision: serverRevision, source: 'server' as FieldSource, at: now },
      witnessConfirmed: isVersioned(raw.witnessConfirmed) ? raw.witnessConfirmed : { value: false, revision: serverRevision, source: 'server' as FieldSource, at: now },
      override: isVersioned(raw.override) ? raw.override : null
    };
  });

  const signatures: StageSignature[] = (Array.isArray(saved?.signatures) && saved.signatures.length ? saved.signatures : seedSignatures).map((raw: any) => ({
    stage: raw.stage,
    status: raw.status ?? '待签署',
    actor: raw.actor ?? '待指定',
    time: raw.time ?? '-',
    revision: typeof raw.revision === 'number' ? raw.revision : serverRevision,
    source: (raw.source ?? 'server') as FieldSource
  }));

  const pending: PendingChange[] = Array.isArray(saved?.pending) ? saved.pending : [];
  const pendingSignatures: PendingSignature[] = Array.isArray(saved?.pendingSignatures) ? saved.pendingSignatures : [];

  return {
    cards,
    signatures,
    serverRevision,
    offline: saved?.offline ?? false,
    syncState: saved?.offline ? 'offline' : pending.length || pendingSignatures.length ? 'pending' : 'synced',
    pending,
    pendingSignatures,
    conflicts: [],
    lastError: '',
    lastSaved: now,
    activeCardId: saved?.activeCardId ?? cards[0]?.id ?? 'CARD-01',
    conflictMessage: saved?.conflictMessage ?? '',
    released: saved?.released ?? false,
    audit: Array.isArray(saved?.audit) ? saved.audit : []
  };
}

const STORAGE_KEY = 'yy61-work-package';
const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
const saved = raw ? JSON.parse(raw) : null;
const initialState: MaintenanceState = migrate(saved);

function setDraftField(card: Card, field: EditableField, value: string | boolean) {
  if (field === 'witnessConfirmed') {
    card.witnessConfirmed = { value: value as boolean, revision: card.witnessConfirmed.revision, source: 'draft', at: nowIso() };
  } else {
    card[field] = { value: value as string, revision: card[field].revision, source: 'draft', at: nowIso() };
  }
}

/** 采用服务器字段值（联合字段索引需显式分支，避免 draft 类型退化为 never） */
function adoptServerField(card: Card, field: EditableField, serverCard: ServerCard) {
  if (field === 'witnessConfirmed') card.witnessConfirmed = { ...serverCard.witnessConfirmed };
  else card[field] = { ...serverCard[field] };
}

/** 合并成功后把本地字段升到服务器修订、来源转 server */
function bumpFieldRevision(card: Card, field: EditableField, revision: number) {
  if (field === 'witnessConfirmed') card.witnessConfirmed = { ...card.witnessConfirmed, revision, source: 'server', at: nowIso() };
  else card[field] = { ...card[field], revision, source: 'server', at: nowIso() };
}

function pendingFieldValue(pending: PendingChange, field: EditableField): string | boolean {
  if (field === 'witnessConfirmed') return pending.fields.witnessConfirmed?.value as boolean;
  return pending.fields[field]?.value as string;
}

const slice = createSlice({
  name: 'maintenance',
  initialState,
  reducers: {
    selectCard(state, action: PayloadAction<string>) {
      state.activeCardId = action.payload;
    },

    /** 离线编辑：字段保留原修订号、来源记为草稿，并进入待合并队列（同一工卡合并为一条） */
    editField(state, action: PayloadAction<{ cardId: string; field: EditableField; value: string | boolean }>) {
      const { cardId, field, value } = action.payload;
      const card = state.cards.find((item) => item.id === cardId);
      if (!card) return;
      const baseRevision = card[field].revision;
      setDraftField(card, field, value);

      let pending = state.pending.find((item) => item.cardId === cardId);
      if (!pending) {
        pending = { clientId: nanoid(), cardId, fields: {}, createdAt: nowIso(), retries: 0 };
        state.pending.push(pending);
      }
      if (field === 'witnessConfirmed') pending.fields.witnessConfirmed = { value: value as boolean, baseRevision };
      else pending.fields[field] = { value: value as string, baseRevision };

      state.syncState = state.offline ? 'offline' : 'pending';
      state.lastSaved = nowTime();
      state.audit.unshift({ time: state.lastSaved, actor: '当前用户', action: '离线暂存', detail: `${card.id} ${fieldLabels[field]} 已存本地草稿（基线 R${baseRevision}）` });
    },

    /** 超差授权：授权记录与工卡当前版本绑定；版本变化时由合并流程作废 */
    authorizeOverride(state, action: PayloadAction<{ cardId: string; eo: string; basis: string }>) {
      const card = state.cards.find((item) => item.id === action.payload.cardId);
      if (!card) return;
      const record: OverrideRecord = {
        eo: action.payload.eo,
        basis: action.payload.basis,
        actor: '放行授权人',
        revision: state.serverRevision,
        at: nowIso()
      };
      card.override = { value: record, revision: state.serverRevision, source: 'override', at: nowIso() };
      card.status = '执行中';

      let pending = state.pending.find((item) => item.cardId === card.id);
      if (!pending) {
        pending = { clientId: nanoid(), cardId: card.id, fields: {}, createdAt: nowIso(), retries: 0 };
        state.pending.push(pending);
      }
      pending.override = record;

      state.syncState = state.offline ? 'offline' : 'pending';
      state.lastSaved = nowTime();
      state.audit.unshift({ time: state.lastSaved, actor: '放行授权人', action: '超差授权', detail: `${card.id} 授权随工卡 R${state.serverRevision} 版本生效：${record.eo}` });
    },

    /** 阶段签署：带修订号与来源，随待合并队列一起提交 */
    signStage(state, action: PayloadAction<{ stage: string; actor: string }>) {
      const signature = state.signatures.find((item) => item.stage === action.payload.stage);
      if (!signature) return;
      signature.status = '已签署';
      signature.actor = action.payload.actor;
      signature.time = nowTime();
      signature.revision = state.serverRevision;
      signature.source = 'signature';

      state.pendingSignatures.push({
        clientId: nanoid(),
        stage: signature.stage,
        actor: signature.actor,
        baseRevision: state.serverRevision,
        createdAt: nowIso(),
        retries: 0
      });

      state.syncState = state.offline ? 'offline' : 'pending';
      state.lastSaved = nowTime();
      state.audit.unshift({ time: state.lastSaved, actor: signature.actor, action: '阶段签署', detail: `${signature.stage}阶段签署（R${state.serverRevision}）已存草稿，待联网合并` });
    },

    setConflict(state, action: PayloadAction<string>) {
      state.conflictMessage = action.payload;
    },

    /** 在线时手动触发合并 */
    requestSync(state) {
      if (state.offline) return;
      if (state.conflicts.length) {
        state.syncState = 'conflict';
        return;
      }
      if (state.pending.length || state.pendingSignatures.length) {
        state.syncState = 'merging';
        state.lastError = '';
      }
    },

    mergeStarted(state) {
      if (state.offline) return;
      state.syncState = 'merging';
      state.lastError = '';
    },

    /** 写入被服务器接受：字段升到新修订、来源转 server，待合并项移除 */
    submitAccepted(state, action: PayloadAction<{ cardId: string; revision: number; idempotent: boolean }>) {
      const { cardId, revision, idempotent } = action.payload;
      const card = state.cards.find((item) => item.id === cardId);
      if (card) {
        for (const field of ['measurement', 'finding', 'witnessConfirmed'] as const) {
          if (card[field].source !== 'server') bumpFieldRevision(card, field, revision);
        }
        if (card.override) card.override = { ...card.override, revision, source: 'server', at: nowIso() };
      }
      state.pending = state.pending.filter((item) => item.cardId !== cardId);
      state.serverRevision = revision;
      state.syncState = state.pending.length || state.pendingSignatures.length ? 'merging' : 'synced';
      state.lastSaved = nowTime();
      state.audit.unshift({
        time: state.lastSaved,
        actor: '系统',
        action: '合并成功',
        detail: idempotent ? `${cardId} 写入已确认（重试幂等，未重复提交），服务器 R${revision}` : `${cardId} 逐字段合并完成，服务器 R${revision}`
      });
    },

    signatureAccepted(state, action: PayloadAction<{ stage: string; revision: number; idempotent: boolean }>) {
      const signature = state.signatures.find((item) => item.stage === action.payload.stage);
      if (signature) {
        signature.revision = action.payload.revision;
        signature.source = 'server';
      }
      state.pendingSignatures = state.pendingSignatures.filter((item) => item.stage !== action.payload.stage);
      state.serverRevision = action.payload.revision;
      state.syncState = state.pending.length || state.pendingSignatures.length ? 'merging' : 'synced';
      state.lastSaved = nowTime();
      state.audit.unshift({
        time: state.lastSaved,
        actor: '系统',
        action: '签署合并成功',
        detail: action.payload.idempotent ? `${action.payload.stage}阶段签署已确认（重试幂等），服务器 R${action.payload.revision}` : `${action.payload.stage}阶段签署已合并，服务器 R${action.payload.revision}`
      });
    },

    /** 服务器判定冲突：保留草稿与待合并改动，登记差异供人工决定 */
    submitConflict(state, action: PayloadAction<{ cardId: string; revision: number; conflicts: FieldConflict[]; overrideStale: boolean }>) {
      const { cardId, revision, conflicts, overrideStale } = action.payload;
      state.serverRevision = revision;
      for (const item of conflicts) {
        if (!state.conflicts.some((entry) => entry.cardId === cardId && entry.field === item.field)) {
          state.conflicts.push({ cardId, field: item.field, label: item.label, baseRevision: item.baseRevision, serverRevision: item.serverRevision, localValue: item.localValue, serverValue: item.serverValue, choice: 'local' });
        }
      }
      state.syncState = 'conflict';
      state.lastError = '';
      state.lastSaved = nowTime();
      state.audit.unshift({ time: state.lastSaved, actor: '系统', action: '合并冲突', detail: `${cardId} 后到数据与先到数据在 ${conflicts.map((item) => item.label).join('、')} 上冲突，已保留草稿，等待查看差异` });

      // 工卡版本已推进：旧超差授权作废，工卡回到待授权
      if (overrideStale) {
        const card = state.cards.find((item) => item.id === cardId);
        if (card?.override) {
          const staleRevision = card.override.revision;
          card.override = null;
          if (card.status === '执行中') card.status = '待授权';
          state.audit.unshift({ time: nowTime(), actor: '系统', action: '授权作废', detail: `${cardId} 工卡版本已变更，原 R${staleRevision} 超差授权作废，需按新版本重新授权` });
        }
        // 授权已随版本作废：移除待合并项中的 override，避免重复提交永远冲突的旧授权
        const pending = state.pending.find((item) => item.cardId === cardId);
        if (pending) {
          delete pending.override;
          if (Object.keys(pending.fields).length === 0) {
            state.pending = state.pending.filter((item) => item !== pending);
          }
        }
      }
    },

    signatureConflict(state, action: PayloadAction<{ stage: string; revision: number; conflicts: FieldConflict[] }>) {
      const { stage, revision, conflicts } = action.payload;
      state.serverRevision = revision;
      for (const item of conflicts) {
        if (!state.conflicts.some((entry) => entry.cardId === 'SIG' && entry.field === item.field)) {
          state.conflicts.push({ cardId: 'SIG', field: item.field, label: item.label, baseRevision: item.baseRevision, serverRevision: item.serverRevision, localValue: item.localValue, serverValue: item.serverValue, choice: 'local' });
        }
      }
      state.syncState = 'conflict';
      state.lastSaved = nowTime();
      state.audit.unshift({ time: nowTime(), actor: '系统', action: '签署冲突', detail: `${stage}阶段签署与先到签署冲突，等待查看差异` });
    },

    /** 写入失败：原草稿与待合并改动原样保留，仅记录错误，可凭同一 clientId 重试 */
    submitFailed(state, action: PayloadAction<{ cardId: string; error: string }>) {
      state.syncState = 'error';
      state.lastError = action.payload.error;
      state.lastSaved = nowTime();
      state.audit.unshift({ time: nowTime(), actor: '系统', action: '写入失败', detail: `${action.payload.cardId} 写入失败：原草稿与待合并改动已保留，重试只提交一次` });
    },

    signatureFailed(state, action: PayloadAction<{ stage: string; error: string }>) {
      state.syncState = 'error';
      state.lastError = action.payload.error;
      state.lastSaved = nowTime();
      state.audit.unshift({ time: nowTime(), actor: '系统', action: '写入失败', detail: `${action.payload.stage}阶段签署写入失败：草稿已保留，可重试` });
    },

    resolveConflict(state, action: PayloadAction<{ cardId: string; field: EditableField | 'signature'; choice: ConflictChoice }>) {
      const entry = state.conflicts.find((item) => item.cardId === action.payload.cardId && item.field === action.payload.field);
      if (entry) entry.choice = action.payload.choice;
    },

    /** 按差异决定执行：选服务器则采用先到数据并移除该字段的待合并项；选本地则带 force 重新提交 */
    applyConflictDecisions(state) {
      for (const entry of state.conflicts) {
        if (entry.choice !== 'server') continue;
        if (entry.field === 'signature') {
          const signature = state.signatures.find((item) => item.stage === entry.label.replace('阶段签署', ''));
          const pending = state.pendingSignatures.find((item) => item.stage === signature?.stage);
          if (pending) state.pendingSignatures = state.pendingSignatures.filter((item) => item !== pending);
          if (signature) {
            const serverValue = entry.serverValue as { status: string; actor: string };
            signature.status = '已签署';
            signature.actor = serverValue.actor;
            signature.revision = entry.serverRevision;
            signature.source = 'server';
          }
        } else {
          const card = state.cards.find((item) => item.id === entry.cardId);
          if (card) {
            if (entry.field === 'witnessConfirmed') {
              card.witnessConfirmed = { value: entry.serverValue as boolean, revision: entry.serverRevision, source: 'server', at: nowIso() };
            } else if (entry.field === 'measurement' || entry.field === 'finding') {
              card[entry.field] = { value: entry.serverValue as string, revision: entry.serverRevision, source: 'server', at: nowIso() };
            }

            const pending = state.pending.find((item) => item.cardId === entry.cardId);
            if (pending) {
              delete pending.fields[entry.field];
              if (Object.keys(pending.fields).length === 0 && !pending.override) {
                state.pending = state.pending.filter((item) => item !== pending);
              }
            }
          }
        }
      }
      state.conflicts = [];
      state.syncState = 'merging';
      state.lastSaved = nowTime();
      state.audit.unshift({ time: nowTime(), actor: '当前用户', action: '差异裁决', detail: '已逐字段查看差异并作出保留本地 / 采用服务器的决定' });
    },

    /**
     * 网络恢复后逐字段合并服务器快照：
     * 服务器字段修订高于基线且本地也改过 -> 登记冲突；否则采用服务器值。
     * 本地授权记录的版本落后于服务器版本 -> 授权作废。
     */
    serverDataApplied(state, action: PayloadAction<WorkPackage>) {
      const pkg = action.payload;
      state.serverRevision = pkg.serverRevision;

      for (const serverCard of pkg.cards) {
        let local = state.cards.find((item) => item.id === serverCard.id);
        if (!local) {
          state.cards.push({ ...serverCard });
          continue;
        }
        local.title = serverCard.title;
        local.zone = serverCard.zone;
        local.revisionText = serverCard.revisionText;
        local.estimated = serverCard.estimated;
        local.dependencies = serverCard.dependencies;
        local.tolerance = serverCard.tolerance;
        local.evidence = serverCard.evidence;
        local.witness = serverCard.witness;
        local.stage = serverCard.stage;

        const pending = state.pending.find((item) => item.cardId === serverCard.id);

        for (const field of ['measurement', 'finding', 'witnessConfirmed'] as const) {
          const serverField = serverCard[field];
          const localField = local[field];
          const localChanged = pending?.fields[field] !== undefined;
          if (serverField.revision > localField.revision) {
            if (localChanged) {
              if (!state.conflicts.some((entry) => entry.cardId === serverCard.id && entry.field === field)) {
                state.conflicts.push({
                  cardId: serverCard.id,
                  field,
                  label: fieldLabels[field],
                  baseRevision: localField.revision,
                  serverRevision: serverField.revision,
                  localValue: pendingFieldValue(pending!, field),
                  serverValue: serverField.value,
                  choice: 'local'
                });
              }
            } else {
              adoptServerField(local, field, serverCard);
            }
          } else if (!localChanged) {
            adoptServerField(local, field, serverCard);
          }
        }

        // 超差授权必须与工卡版本同效：版本推进则旧授权作废
        if (local.override) {
          const serverOverride = serverCard.override;
          if (serverOverride && serverOverride.revision > local.override.revision) {
            local.override = { ...serverOverride };
          } else if (pkg.serverRevision > local.override.revision) {
            const staleRevision = local.override.revision;
            local.override = null;
            if (local.status === '执行中') local.status = '待授权';
            state.audit.unshift({ time: nowTime(), actor: '系统', action: '授权作废', detail: `${serverCard.id} 工卡已升至 R${pkg.serverRevision}，原 R${staleRevision} 超差授权作废` });
          }
        }
      }

      for (const serverSignature of pkg.signatures) {
        const local = state.signatures.find((item) => item.stage === serverSignature.stage);
        if (!local) continue;
        const pendingSignature = state.pendingSignatures.find((item) => item.stage === serverSignature.stage);
        if (serverSignature.status === '已签署') {
          if (pendingSignature && serverSignature.revision > pendingSignature.baseRevision) {
            if (!state.conflicts.some((entry) => entry.cardId === 'SIG' && entry.field === 'signature')) {
              state.conflicts.push({
                cardId: 'SIG',
                field: 'signature',
                label: `${serverSignature.stage}阶段签署`,
                baseRevision: pendingSignature.baseRevision,
                serverRevision: serverSignature.revision,
                localValue: { status: '已签署', actor: pendingSignature.actor },
                serverValue: { status: '已签署', actor: serverSignature.actor },
                choice: 'local'
              });
            }
          } else {
            local.status = '已签署';
            local.actor = serverSignature.actor;
            local.time = serverSignature.time;
            local.revision = serverSignature.revision;
            local.source = 'server';
          }
        }
      }

      if (state.conflicts.length) state.syncState = 'conflict';
      else if (state.offline) state.syncState = 'offline';
      else if (state.pending.length || state.pendingSignatures.length) state.syncState = 'merging';
      else state.syncState = 'synced';
      state.lastSaved = nowTime();
    },

    toggleOffline(state) {
      state.offline = !state.offline;
      if (state.offline) {
        state.syncState = 'offline';
      } else if (state.conflicts.length) {
        state.syncState = 'conflict';
      } else if (state.pending.length || state.pendingSignatures.length) {
        state.syncState = 'merging';
      } else {
        state.syncState = 'synced';
      }
    },

    releasePackage(state) {
      const hasBlockers = state.cards.some((card) => card.status === '待授权');
      const allSigned = state.signatures.every((item) => item.status === '已签署');
      if (!hasBlockers && allSigned) {
        state.released = true;
        state.audit.unshift({ time: nowTime(), actor: '质量经理', action: '锁定放行', detail: `工作包 R${state.serverRevision} 已锁定并形成放行基线` });
      }
    }
  }
});

export const {
  selectCard,
  editField,
  authorizeOverride,
  signStage,
  setConflict,
  requestSync,
  mergeStarted,
  submitAccepted,
  signatureAccepted,
  submitConflict,
  signatureConflict,
  submitFailed,
  signatureFailed,
  resolveConflict,
  applyConflictDecisions,
  serverDataApplied,
  toggleOffline,
  releasePackage
} = slice.actions;

export const store = configureStore({
  reducer: { maintenance: slice.reducer, [maintenanceApi.reducerPath]: maintenanceApi.reducer },
  middleware: (getDefault) => getDefault().concat(maintenanceApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState().maintenance));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
