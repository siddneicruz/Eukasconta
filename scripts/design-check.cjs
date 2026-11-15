// Guarda do sistema de design: falha se aparecerem tamanhos de fonte, raios, sombras ou cores fixas fora da escala.
// Uso: npm run design-check
const fs = require('fs'), path = require('path');
const files = [];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) { if (!['node_modules', 'dist', 'android', '.git'].includes(e.name)) walk(p); }
  else if (/\.tsx$/.test(e.name)) files.push(p);
});
walk('.');
const rules = [
  { name: 'fonte fora da escala (10·11·12·13·14·16·18·24)', re: /text-\[(\d+(?:\.\d+)?)px\]/g, ok: m => ['10', '11', '12', '13', '14', '16', '18', '24'].includes(m[1]) },
  { name: 'raio fora da escala (2rem · 2.5rem)', re: /rounded-\[([\d.]+rem)\]/g, ok: m => ['2rem', '2.5rem'].includes(m[1]) },
  { name: 'sombra 3xl (use shadow-2xl)', re: /shadow-3xl/g, ok: () => false },
  { name: 'fundo fixo (use bg-ek-page / bg-ek-card / bg-ek-card2)', re: /\bbg-\[#(121214|0c0c0e|09090b)\]/g, ok: () => false },
];
let bad = 0;
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const r of rules) for (const m of t.matchAll(r.re)) if (!r.ok(m)) { bad++; console.log(`${f}: ${r.name} -> ${m[0]}`); }
}
console.log(bad ? `\n${bad} problema(s)` : 'design-check: ok');
process.exit(bad ? 1 : 0);
