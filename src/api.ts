import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';

export type CardStatus = '未开始' | '执行中' | '待授权' | '已完成';
export type MergeFieldKey = 'measurement' | 'finding' | 'witness';

export type FieldTraceDTO = {
  value: string;
  rev: number;
  source: string;
  device: string;
  time: string;
};

export type ServerCard = {
  id: string;
  title: string;
  zone: string;
  revision: string;
  rev: number;
  estimated: number;
  dependencies: string[];
  tolerance: string;
  evidence: string;
  witness: string;
  stage: string;
  status: CardStatus;
  fields: Record<MergeFieldKey, FieldTraceDTO>;
};

export type ServerSignature = {
  stage: string;
  status: '待签署' | '已签署';
  actor: string;
  rev: number;
  source: string;
  device: string;
  time: string;
};

export type ServerOverride = {
  id: string;
  cardId: string;
  cardRev: number;
  revision: string;
  eo: string;
  basis: string;
  actor: string;
  device: string;
  time: string;
};

export type PackageSnapshot = {
  id: string;
  aircraft: string;
  type: string;
  check: string;
  station: string;
  plannedStart: string;
  plannedEnd: string;
  revision: string;
  serverRevision: number;
  tasks: ServerCard[];
  signatures: ServerSignature[];
  overrides: ServerOverride[];
};

/* 离线待合并改动（一条 = 一个字段 / 一次授权 / 一次签署），携带修订号与来源 */
export type ChangeDTO = {
  token: string;
  kind: 'field' | 'override' | 'signature' | 'complete';
  cardId?: string;
  field?: MergeFieldKey;
  value?: string;
  baseValue?: string;
  stage?: string;
  eo?: string;
  basis?: string;
  baseRev: number;
  cardRev?: number;
  origin: string;
  device: string;
};

export type ChangeOutcome = {
  token: string;
  result: 'accepted' | 'noop' | 'conflict' | 'staleOverride' | 'rejected';
  reason?: string;
  serverRevision: number;
  conflict?: {
    baseValue: string;
    serverValue: string;
    localValue: string;
    serverSource: string;
    serverDevice: string;
    serverTime: string;
    serverRev: number;
  };
};

export type SyncResponse = {
  serverRevision: number;
  outcomes: ChangeOutcome[];
  snapshot: PackageSnapshot;
};

export const LOCAL_ORIGIN = '本地草稿 · 宋杰 · 机械';
export const LOCAL_DEVICE = '机库离线终端 H3-PAD-02';
export const PEER_ORIGIN = '对端终端 · 林爽 · 检验';
export const PEER_DEVICE = '机库终端 H3-PAD-07';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nowHM = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

function field(value: string, rev: number, source: string, device: string, time: string): FieldTraceDTO {
  return { value, rev, source, device, time };
}

/* ---- 可变的“服务器”状态：字段各自带修订号，合并按字段进行 ---- */
export function buildInitialSnapshot(): PackageSnapshot {
  const mk = (
    id: string,
    title: string,
    zone: string,
    revision: string,
    estimated: number,
    dependencies: string[],
    tolerance: string,
    evidence: string,
    witness: string,
    status: CardStatus,
    stage: string,
    fields: Record<MergeFieldKey, FieldTraceDTO>
  ): ServerCard => ({ id, title, zone, revision, rev: Number(revision.slice(1)), estimated, dependencies, tolerance, evidence, witness, status, stage, fields });

  return {
    id: 'WP-B7891-04',
    aircraft: 'B-7891',
    type: 'B737-800',
    check: '48A 定检',
    station: '上海浦东 · H3 机库',
    plannedStart: '2026-09-28 06:00',
    plannedEnd: '2026-09-30 18:00',
    revision: 'WP R7',
    serverRevision: 7,
    tasks: [
      mk('CARD-01', '右主起落架收放检查', '起落架舱 RH', 'R7', 3.5, [], '间隙 1.2–2.0 mm', '近照 + 动作记录', '检验员', '已完成', '机械签署', {
        measurement: field('1.62 mm', 7, '服务器基线 · 赵明 · 机械', LOCAL_DEVICE, '09:18'),
        finding: field('正常', 7, '服务器基线 · 赵明 · 机械', LOCAL_DEVICE, '09:18'),
        witness: field('已确认', 7, '服务器基线 · 检验员现场见证', LOCAL_DEVICE, '09:18')
      }),
      mk('CARD-02', '发动机 2 风扇叶片孔探', '发动机 2', 'R7', 4.2, ['CARD-01'], '凹坑 ≤ 0.3 mm', '孔探照片 + 视频', '发动机工程师', '执行中', '发动机签署', {
        measurement: field('', 7, '尚无数据', LOCAL_DEVICE, '-'),
        finding: field('', 7, '尚无数据', LOCAL_DEVICE, '-'),
        witness: field('', 7, '尚无数据', LOCAL_DEVICE, '-')
      }),
      mk('CARD-03', '液压系统压力保持测试', '轮舱 / 系统 A', 'R6', 2.0, ['CARD-01'], '≥ 2850 psi / 10 min', '压力仪记录', '质量检验', '待授权', '系统签署', {
        measurement: field('2762 psi', 7, '服务器基线 · 宋杰 · 机械', LOCAL_DEVICE, '09:05'),
        finding: field('低于容差，等待授权', 7, '服务器基线 · 宋杰 · 机械', LOCAL_DEVICE, '09:05'),
        witness: field('已确认', 7, '服务器基线 · 质量检验现场见证', LOCAL_DEVICE, '09:05')
      }),
      mk('CARD-04', '前起落架时寿件核对', '前起落架', 'R7', 1.5, [], '剩余循环 ≥ 500', '件号照片 + 履历页', '检验员', '已完成', '适航签署', {
        measurement: field('剩余 836 循环', 7, '服务器基线 · 赵明 · 机械', LOCAL_DEVICE, '09:12'),
        finding: field('正常', 7, '服务器基线 · 赵明 · 机械', LOCAL_DEVICE, '09:12'),
        witness: field('已确认', 7, '服务器基线 · 检验员现场见证', LOCAL_DEVICE, '09:12')
      }),
      mk('CARD-05', 'AD 2024-15-03 执行确认', '机身后段', 'R7', 2.5, ['CARD-04'], '按 AD 标准施工', '施工记录 + 签署', '放行人员', '未开始', '适航签署', {
        measurement: field('', 7, '尚无数据', LOCAL_DEVICE, '-'),
        finding: field('', 7, '尚无数据', LOCAL_DEVICE, '-'),
        witness: field('', 7, '尚无数据', LOCAL_DEVICE, '-')
      }),
      mk('CARD-06', '客舱应急设备检查', '客舱全舱', 'R7', 2.8, [], '全部在有效期内', '清单复核', '客舱检验', '未开始', '客舱签署', {
        measurement: field('', 7, '尚无数据', LOCAL_DEVICE, '-'),
        finding: field('', 7, '尚无数据', LOCAL_DEVICE, '-'),
        witness: field('', 7, '尚无数据', LOCAL_DEVICE, '-')
      }),
      mk('CARD-07', 'APU 排故后试车', 'APU 舱', 'R5', 3.0, ['CARD-03'], '参数在 AMM 范围', '试车数据 + 油样', '动力工程师', '未开始', '动力签署', {
        measurement: field('', 5, '尚无数据', LOCAL_DEVICE, '-'),
        finding: field('', 5, '尚无数据', LOCAL_DEVICE, '-'),
        witness: field('', 5, '尚无数据', LOCAL_DEVICE, '-')
      }),
      mk('CARD-08', '重复缺陷趋势复核', '全机', 'R7', 1.0, ['CARD-02', 'CARD-03'], '无新增重复缺陷', '近 3 次记录', '质量经理', '执行中', '放行签署', {
        measurement: field('发现 2 次压力偏低', 7, '服务器基线 · 质量经理', LOCAL_DEVICE, '09:30'),
        finding: field('移交可靠性分析', 7, '服务器基线 · 质量经理', LOCAL_DEVICE, '09:30'),
        witness: field('', 7, '尚无数据', LOCAL_DEVICE, '-')
      })
    ] as ServerCard[],
    signatures: [
      { stage: '机械', status: '已签署', actor: '赵明 · 机械师', rev: 7, source: '服务器基线 · 阶段签署', device: LOCAL_DEVICE, time: '09:18' },
      { stage: '系统', status: '待签署', actor: '', rev: 7, source: '尚无数据', device: LOCAL_DEVICE, time: '-' },
      { stage: '动力', status: '待签署', actor: '', rev: 7, source: '尚无数据', device: LOCAL_DEVICE, time: '-' },
      { stage: '放行', status: '待签署', actor: '', rev: 7, source: '尚无数据', device: LOCAL_DEVICE, time: '-' }
    ] as ServerSignature[],
    overrides: [] as ServerOverride[]
  };
}

type ServerState = PackageSnapshot & { failNextSync: boolean; applied: Map<string, ChangeOutcome> };
const initialSnapshot = buildInitialSnapshot();
const server: ServerState = {
  ...initialSnapshot,
  tasks: initialSnapshot.tasks.map((card) => ({ ...card, fields: { ...card.fields } })),
  signatures: initialSnapshot.signatures.map((item) => ({ ...item })),
  overrides: [],
  failNextSync: false,
  applied: new Map<string, ChangeOutcome>()
};

function snapshot(): PackageSnapshot {
  return {
    id: server.id,
    aircraft: server.aircraft,
    type: server.type,
    check: server.check,
    station: server.station,
    plannedStart: server.plannedStart,
    plannedEnd: server.plannedEnd,
    revision: server.revision,
    serverRevision: server.serverRevision,
    tasks: server.tasks.map((card) => ({ ...card, fields: { ...card.fields } })),
    signatures: server.signatures.map((item) => ({ ...item })),
    overrides: server.overrides.map((item) => ({ ...item }))
  };
}

const nextRev = () => {
  server.serverRevision += 1;
  return server.serverRevision;
};

const validOverrideFor = (card: ServerCard) =>
  server.overrides.find((item) => item.cardId === card.id && item.cardRev === card.rev && item.revision === card.revision);

/* 单个字段三方合并：base 为该终端上次采用的服务器值 */
function mergeField(card: ServerCard, key: MergeFieldKey, change: ChangeDTO): ChangeOutcome {
  const current = card.fields[key];
  const base = change.baseValue ?? '';
  const local = change.value ?? '';
  if (local === current.value) {
    return { token: change.token, result: 'noop', serverRevision: server.serverRevision };
  }
  if (base !== current.value) {
    return {
      token: change.token,
      result: 'conflict',
      serverRevision: server.serverRevision,
      conflict: {
        baseValue: base,
        serverValue: current.value,
        localValue: local,
        serverSource: current.source,
        serverDevice: current.device,
        serverTime: current.time,
        serverRev: current.rev
      }
    };
  }
  const rev = nextRev();
  card.fields[key] = { value: local, rev, source: change.origin, device: change.device, time: nowHM() };
  if (key === 'measurement' && local && card.status === '未开始') card.status = '执行中';
  return { token: change.token, result: 'accepted', serverRevision: server.serverRevision };
}

function applyChange(change: ChangeDTO): ChangeOutcome {
  const card = change.cardId ? server.tasks.find((item) => item.id === change.cardId) : undefined;

  if (change.kind === 'field' && card && change.field) {
    return mergeField(card, change.field, change);
  }

  if (change.kind === 'signature' && change.stage) {
    const sig = server.signatures.find((item) => item.stage === change.stage);
    if (!sig) return { token: change.token, result: 'rejected', reason: `阶段 ${change.stage} 不存在`, serverRevision: server.serverRevision };
    const local = change.value ?? '';
    if (sig.status === '已签署' && sig.actor === local) {
      return { token: change.token, result: 'noop', serverRevision: server.serverRevision };
    }
    if (sig.status === '已签署') {
      return {
        token: change.token,
        result: 'conflict',
        serverRevision: server.serverRevision,
        conflict: {
          baseValue: change.baseValue ?? '',
          serverValue: sig.actor,
          localValue: local,
          serverSource: sig.source,
          serverDevice: sig.device,
          serverTime: sig.time,
          serverRev: sig.rev
        }
      };
    }
    const rev = nextRev();
    sig.status = '已签署';
    sig.actor = local;
    sig.rev = rev;
    sig.source = change.origin;
    sig.device = change.device;
    sig.time = nowHM();
    return { token: change.token, result: 'accepted', serverRevision: server.serverRevision };
  }

  if (change.kind === 'override' && card) {
    /* 超差处理必须与对应工卡版本一起生效：版本变化，旧确认直接作废 */
    if (change.cardRev !== card.rev || (change.cardRev === undefined)) {
      return {
        token: change.token,
        result: 'staleOverride',
        reason: `授权确认绑定 ${change.cardRev !== undefined ? 'R' + change.cardRev : '未知版本'}，工卡已升级到 ${card.revision}，旧确认作废，须在新版本重新授权`,
        serverRevision: server.serverRevision
      };
    }
    nextRev();
    const rec: ServerOverride = {
      id: change.token,
      cardId: card.id,
      cardRev: card.rev,
      revision: card.revision,
      eo: change.eo ?? '',
      basis: change.basis ?? '',
      actor: '放行授权人 · 周正',
      device: change.device,
      time: nowHM()
    };
    const idx = server.overrides.findIndex((item) => item.cardId === card.id && item.cardRev === card.rev);
    if (idx >= 0) server.overrides[idx] = rec;
    else server.overrides.push(rec);
    card.status = '执行中';
    return { token: change.token, result: 'accepted', serverRevision: server.serverRevision };  }

  if (change.kind === 'complete' && card) {
    if (change.cardRev !== undefined && change.cardRev !== card.rev) {
      return {
        token: change.token,
        result: 'rejected',
        reason: `${card.id} 完成时依据 R${change.cardRev}，工卡已升级到 ${card.revision}，须按新版本复核后重新提交`,
        serverRevision: server.serverRevision
      };
    }
    if (!card.fields.measurement.value) {
      return { token: change.token, result: 'rejected', reason: `${card.id} 缺少测量值，不能完成`, serverRevision: server.serverRevision };
    }
    if (card.fields.witness.value !== '已确认') {
      return { token: change.token, result: 'rejected', reason: `${card.id} 见证确认未完成，不能完成`, serverRevision: server.serverRevision };
    }
    if (card.status === '待授权' && !validOverrideFor(card)) {
      return {
        token: change.token,
        result: 'rejected',
        reason: `${card.id} 存在超差：授权确认缺失或不匹配当前工卡版本 ${card.revision}，不能完成`,
        serverRevision: server.serverRevision
      };
    }
    card.status = '已完成';
    return { token: change.token, result: 'accepted', serverRevision: server.serverRevision };
  }

  return { token: change.token, result: 'rejected', reason: '未知的改动类型', serverRevision: server.serverRevision };
}

const mockBaseQuery: BaseQueryFn = async (arg) => {
  if (typeof arg === 'string' && arg === 'package') {
    await delay(120);
    return { data: snapshot() };
  }
  if (typeof arg === 'object' && arg !== null && 'url' in arg) {
    const request = arg as { url: string; body?: unknown };
    await delay(request.url === 'sync' ? 260 : 160);

    if (request.url === 'package') return { data: snapshot() };

    if (request.url === 'armFailure') {
      server.failNextSync = true;
      return { data: { armed: true } };
    }

    if (request.url === 'peerChange') {
      const payload = request.body as { cardId?: string; field?: MergeFieldKey; value?: string; stage?: string; actor?: string };
      if (payload.cardId && payload.field) {
        const card = server.tasks.find((item) => item.id === payload.cardId);
        if (card) {
          const rev = nextRev();
          card.fields[payload.field] = { value: payload.value ?? '', rev, source: PEER_ORIGIN, device: PEER_DEVICE, time: nowHM() };
          if (payload.field === 'measurement' && card.status === '未开始') card.status = '执行中';
        }
      }
      if (payload.stage) {
        const sig = server.signatures.find((item) => item.stage === payload.stage);
        if (sig && sig.status === '待签署') {
          const rev = nextRev();
          sig.status = '已签署';
          sig.actor = payload.actor ?? '林爽 · 检验';
          sig.rev = rev;
          sig.source = PEER_ORIGIN;
          sig.device = PEER_DEVICE;
          sig.time = nowHM();
        }
      }
      return { data: { snapshot: snapshot() } };
    }

    if (request.url === 'bumpRevision') {
      const payload = request.body as { cardId: string };
      const card = server.tasks.find((item) => item.id === payload.cardId);
      if (card) {
        card.rev += 1;
        card.revision = `R${card.rev}`;
        /* 版本一升，绑旧版本的超差确认立即失效，项目回到待授权 */
        if (server.overrides.some((item) => item.cardId === card.id && item.cardRev < card.rev)) {
          card.status = '待授权';
        }
      }
      return { data: { snapshot: snapshot() } };
    }

    if (request.url === 'sync') {
      if (server.failNextSync) {
        server.failNextSync = false;
        return { error: { status: 500, data: { message: '写入失败：链路中断，服务器未接受任何改动，请保留原草稿后重试。' } } };
      }
      const body = request.body as { changes: ChangeDTO[] };
      const outcomes: ChangeOutcome[] = [];
      for (const change of body.changes) {
        const previous = server.applied.get(change.token);
        /* 令牌幂等：重试绝不重复提交同一条改动 */
        const outcome = previous
          ? { ...previous, serverRevision: server.serverRevision }
          : applyChange(change);
        if (!previous) server.applied.set(change.token, outcome);
        outcomes.push(outcome);
      }
      return { data: { serverRevision: server.serverRevision, outcomes, snapshot: snapshot() } satisfies SyncResponse };
    }
  }
  return { error: { status: 404, data: 'Not found' } };
};

export const maintenanceApi = createApi({
  reducerPath: 'maintenanceApi',
  baseQuery: mockBaseQuery,
  tagTypes: ['Package'],
  endpoints: (builder) => ({
    getWorkPackage: builder.query<PackageSnapshot, void>({
      query: () => 'package',
      providesTags: ['Package']
    }),
    syncChanges: builder.mutation<SyncResponse, { changes: ChangeDTO[] }>({
      query: (body) => ({ url: 'sync', body })
    }),
    peerChange: builder.mutation<{ snapshot: PackageSnapshot }, { cardId?: string; field?: MergeFieldKey; value?: string; stage?: string; actor?: string }>({
      query: (body) => ({ url: 'peerChange', body })
    }),
    bumpCardRevision: builder.mutation<{ snapshot: PackageSnapshot }, { cardId: string }>({
      query: (body) => ({ url: 'bumpRevision', body })
    }),
    armFailure: builder.mutation<{ armed: boolean }, void>({
      query: () => ({ url: 'armFailure' })
    })
  })
});

export const { useGetWorkPackageQuery, useSyncChangesMutation, usePeerChangeMutation, useBumpCardRevisionMutation, useArmFailureMutation } = maintenanceApi;
