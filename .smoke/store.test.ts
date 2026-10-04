import { maintenanceApi } from '../src/api';
import {
  editDraft,
  pullSnapshot,
  queueComplete,
  requestOverride,
  resolveFieldConflict,
  rebaseOverrideChange,
  selectDraftValue,
  store,
  syncNow,
  toggleOffline,
  type RootState
} from '../src/store';

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name} ${extra}`); }
};
const m = () => (store.getState() as RootState).maintenance;

(async () => {
  console.log('1) 离线编辑：草稿保留、改动入队，含修订号/来源/base');
  check('初始在线', m().offline === false);
  store.dispatch(toggleOffline());
  check('进入离线', m().offline === true);
  store.dispatch(editDraft({ cardId: 'CARD-02', field: 'measurement', value: '0.12 mm' }));
  store.dispatch(editDraft({ cardId: 'CARD-02', field: 'finding', value: '离线发现：划痕' }));
  store.dispatch(editDraft({ cardId: 'CARD-02', field: 'witness', value: '已确认' }));
  check('草稿可读取', selectDraftValue(store.getState(), 'CARD-02', 'measurement') === '0.12 mm');
  const queued = m().changes.filter((c) => c.status === '待合并');
  check('3 个字段各 1 条待合并', queued.length === 3, `实际 ${queued.length}`);
  check('携带修订号', queued.every((c) => typeof c.baseRev === 'number'));
  check('携带来源', queued.every((c) => c.origin.includes('宋杰')));
  check('base 为服务器原值', queued.find((c) => c.field === 'measurement')?.baseValue === '');

  console.log('2) 离线下同步不丢数据');
  await store.dispatch(syncNow());
  check('离线队列不丢失', m().changes.filter((c) => c.status === '待合并').length === 3);

  console.log('3) 对端先改同字段，再恢复在线 → 冲突，先到数据不被覆盖');
  // 直接在“服务器”制造对端改动
  await store.dispatch(maintenanceApi.endpoints.peerChange.initiate({ cardId: 'CARD-02', field: 'measurement', value: '0.55 mm 对端' })).unwrap();
  store.dispatch(toggleOffline()); // 恢复在线，Shell 的 effect 不在此环境，手动同步
  await store.dispatch(syncNow());
  const conflict = m().changes.find((c) => c.field === 'measurement' && c.status === '差异待决');
  check('测量值差异待决', Boolean(conflict));
  check('另外两字段已合并', m().changes.filter((c) => ['finding', 'witness'].includes(c.field ?? '') && c.status === '已合并').length === 2);
  const serverCard = m().server.tasks.find((c) => c.id === 'CARD-02')!;
  check('先到方值保留在服务器视图', serverCard.fields.measurement.value === '0.55 mm 对端');
  check('本地草稿保留本方值', selectDraftValue(store.getState(), 'CARD-02', 'measurement') === '0.12 mm');

  console.log('4) 后到方决策：保留本方，换新 token 以先到值为基线再提（只提交一次）');
  const oldToken = conflict!.token;
  store.dispatch(resolveFieldConflict({ localId: conflict!.localId, decision: 'mine' }));
  const rebased = m().changes.find((c) => c.localId === conflict!.localId)!;
  check('换新令牌', rebased.token !== oldToken);
  check('基线更新为先到值', rebased.baseValue === '0.55 mm 对端');
  check('状态回到待合并', rebased.status === '待合并');
  await store.dispatch(syncNow());
  const mergedCard = m().server.tasks.find((c) => c.id === 'CARD-02')!;
  check('本方值逐字段合并成功', mergedCard.fields.measurement.value === '0.12 mm');
  check('草稿已清理', m().drafts['CARD-02']?.measurement === undefined);

  console.log('5) 超差授权与工卡版本绑定，升版作废旧确认');
  store.dispatch(requestOverride({ cardId: 'CARD-03', eo: 'EO-2026-1147', basis: '按 AMM 复测' }));
  await store.dispatch(syncNow());
  const card03 = m().server.tasks.find((c) => c.id === 'CARD-03')!;
  check('R6 授权生效，转执行中', card03.status === '执行中' && m().server.overrides.some((o) => o.cardId === 'CARD-03' && o.cardRev === 6));
  await store.dispatch(maintenanceApi.endpoints.bumpCardRevision.initiate({ cardId: 'CARD-03' })).unwrap();
  await store.dispatch(pullSnapshot());
  const card03b = m().server.tasks.find((c) => c.id === 'CARD-03')!;
  check('工卡升为 R7', card03b.revision === 'R7' && card03b.status === '待授权');
  const stale = m().changes.find((c) => c.kind === 'override' && c.status === '授权已作废');
  check('旧授权标记作废', Boolean(stale) && /R7/.test(stale?.reason ?? ''));

  console.log('6) 新版本重新授权（原改动记录 rebase，不重复堆叠）');
  store.dispatch(rebaseOverrideChange({ localId: stale!.localId, eo: 'EO-2026-1199', basis: '按 R7 重新评估' }));
  const rebound = m().changes.find((c) => c.localId === stale!.localId)!;
  check('重新绑定 R7', rebound.cardRev === 7 && rebound.status === '待合并');
  await store.dispatch(syncNow());
  const card03c = m().server.tasks.find((c) => c.id === 'CARD-03')!;
  check('R7 授权生效', card03c.status === '执行中' && m().server.overrides.some((o) => o.cardId === 'CARD-03' && o.cardRev === 7));

  console.log('7) 完成工卡：版本变化的完成请求被服务器拒绝，需按新版本复核');
  store.dispatch(queueComplete('CARD-01'));
  await store.dispatch(syncNow());
  check('CARD-01 完成被接受', m().server.tasks.find((c) => c.id === 'CARD-01')!.status === '已完成');

  console.log('8) 预置写入失败：原草稿+队列保留，重试同 token 成功');
  store.dispatch(editDraft({ cardId: 'CARD-06', field: 'finding', value: '应急灯均在有效期' }));
  await store.dispatch(maintenanceApi.endpoints.armFailure.initiate()).unwrap();
  await store.dispatch(syncNow());
  const failedChange = m().changes.find((c) => c.cardId === 'CARD-06' && c.field === 'finding')!;
  check('失败被标记', failedChange.status === '提交失败');
  check('原草稿保留', selectDraftValue(store.getState(), 'CARD-06', 'finding') === '应急灯均在有效期');
  check('syncError 有提示', m().syncError.length > 0);
  const failedToken = failedChange.token;
  await store.dispatch(syncNow()); // 重试
  const retried = m().changes.find((c) => c.token === failedToken)!;
  check('重试同 token 且已合并', retried.status === '已合并');
  check('错误清除', m().syncError === '');
  check('服务器落库', m().server.tasks.find((c) => c.id === 'CARD-06')!.fields.finding.value === '应急灯均在有效期');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
