// 模拟旧版 localStorage（无 schemaVersion、无字段修订号），验证按当前版本升级
const legacy = JSON.stringify({
  cards: [
    { id: 'CARD-02', measurement: '凹坑 0.28 mm', finding: '可接受' },
    { id: 'CARD-06', measurement: '', finding: '2 件救生衣即将到期' }
  ],
  activeCardId: 'CARD-02',
  audit: []
});
const mem = new Map<string, string>();
mem.set('yy61-work-package', legacy);
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => mem.set(k, v),
  removeItem: (k: string) => mem.delete(k)
};

// 动态导入：确保在 localStorage 就绪之后再初始化 store
const storeModule = await import('../src/store');
const { store } = storeModule;
type RootState = ReturnType<typeof store.getState>;

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = '') => cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.error(`  ✗ ${name} ${extra}`));
const m = () => (store.getState() as RootState).maintenance;

const changes = m().changes;
check('旧草稿差异生成待合并改动', changes.filter((c) => c.status === '待合并').length >= 2, `实际 ${changes.length}`);
const c02m = changes.find((c) => c.cardId === 'CARD-02' && c.field === 'measurement')!;
check('测量值带当前版本基线', c02m.baseValue === '' && c02m.value === '凹坑 0.28 mm');
check('补了修订号', c02m.baseRev === 7);
check('来源标注旧草稿升级', c02m.origin.includes('旧草稿升级'));
check('草稿可读回旧值', m().drafts['CARD-02']?.measurement === '凹坑 0.28 mm');
check('activeCardId 保留', m().activeCardId === 'CARD-02');
check('有升级提示', m().syncError.includes('旧草稿'));
check('审计记录升级动作', m().audit[0].action === '旧草稿升级');
check('无差异字段不入队', !changes.some((c) => c.cardId === 'CARD-01'));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
