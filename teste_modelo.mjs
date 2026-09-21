/* Teste de fumaça sobre a BASE REAL preparada por data/preparar_dados.py.
   Confere o pipeline, os dois níveis de denominador e o modelo.
   Rodar a partir da raiz:  deno run --allow-read teste_modelo.mjs
                            node teste_modelo.mjs                    */
import fs from 'node:fs';
import {
  normalizarUfDoencas, normalizarUfAbates, normalizarMunicipios,
  filtrarUfDoencas, filtrarUfAbates, filtrarMunicipios,
  porUF, porMunicipioAno, porDiagnostico, porMunicipio, mediana,
} from './js/transform.js';
import { detectar } from './js/anomalia.js';
import { MIN_ABATIDOS_UF } from './js/config.js';

function lerCsv(caminho) {
  const texto = fs.readFileSync(caminho, 'utf-8');
  const linhas = texto.split(/\r?\n/).filter(Boolean);
  const campos = linhas[0].split(';');
  return {
    linhas: linhas.slice(1).map((l) => {
      const partes = l.split(';');
      return Object.fromEntries(campos.map((c, i) => [c, partes[i]]));
    }),
    campos,
  };
}

let falhas = 0;
const confere = (nome, ok, detalhe = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas += 1;
};

console.log('1. leitura e normalização');
const d = normalizarUfDoencas(lerCsv('data/sif_uf_doencas.csv'));
const a = normalizarUfAbates(lerCsv('data/sif_uf_abates.csv'));
const m = normalizarMunicipios(lerCsv('data/sif_municipio_doencas.csv'));
confere('doenças por UF', d.registros.length > 10000, `${d.registros.length} linhas, ${d.descartadas} descartadas`);
confere('abates por UF', a.registros.length > 500, `${a.registros.length} linhas`);
confere('doenças por município', m.registros.length > 10000, `${m.registros.length} linhas, ${m.descartadas} descartadas`);
confere('todo município tem rebanho', m.registros.every((r) => r.rebanho > 0));

const anos = [...new Set(d.registros.map((r) => r.ano))].sort((x, y) => x - y);
confere('série começa em 2021 (pós PGA-SIGSIF)', anos[0] === 2021, `${anos[0]}–${anos.at(-1)}`);
confere('só bovinos e bubalinos', new Set(d.registros.map((r) => r.especie)).size <= 2,
  [...new Set(d.registros.map((r) => r.especie))].join(', '));

const f = { uf: 'todos', municipio: 'todos', especie: 'todos', diagnostico: 'todos', anoIni: anos[0], anoFim: anos.at(-1) };

console.log('\n2. nível UF — casos por cabeça abatida');
const linhasUF = porUF(filtrarUfDoencas(d.registros, f), filtrarUfAbates(a.registros, f), MIN_ABATIDOS_UF);
confere('UFs com volume suficiente', linhasUF.length >= 15, `${linhasUF.length} de 27`);
linhasUF.slice(0, 5).forEach((u) => console.log(`      ${u.uf}  ${u.taxa.toFixed(1)}  (${u.casos.toLocaleString('pt-BR')} casos / ${u.abatidos.toLocaleString('pt-BR')} abatidas)`));

console.log('\n3. nível município — casos por cabeça de rebanho');
const unidades = porMunicipioAno(filtrarMunicipios(m.registros, f));
confere('unidades município × ano', unidades.length > 5000, `${unidades.length}`);
confere('taxa municipal finita', unidades.every((u) => Number.isFinite(u.taxa)));
const agregados = porMunicipio(unidades);
confere('municípios distintos', agregados.length > 2000, `${agregados.length}`);

console.log('\n4. calibração — hidatidose deve pesar mais no Sul');
const hid = d.registros.filter((r) => /hidatidose/i.test(r.diagnostico));
if (hid.length) {
  const porUf = porUF(hid, filtrarUfAbates(a.registros, f), MIN_ABATIDOS_UF);
  porUf.slice(0, 4).forEach((u) => console.log(`      ${u.uf}  ${u.taxa.toFixed(1)}`));
  confere('RS entre os 3 primeiros em hidatidose',
    porUf.slice(0, 3).some((u) => u.uf === 'RS'), porUf.slice(0, 3).map((u) => u.uf).join(' '));
} else {
  confere('hidatidose presente na base', false);
}

console.log('\n5. modelo');
const t0 = Date.now();
const res = detectar(unidades);
confere('modelo rodou', res.diagnostico.suficiente,
  `${res.diagnostico.treinadas} unidades em ${Date.now() - t0} ms`);
confere('alertas dentro da fração esperada',
  res.alertas.length > 0 && res.alertas.length < res.diagnostico.treinadas * 0.1,
  `${res.alertas.length} alertas`);
confere('todo alerta está acima da mediana', res.alertas.every((u) => u.z > 0));
console.log(`      concordância com a linha de base: ${(res.diagnostico.concordancia * 100).toFixed(0)}%`);
console.log('      10 primeiros:');
res.alertas.slice(0, 10).forEach((u) => console.log(
  `        ${u.municipio}/${u.uf} ${u.ano}  taxa ${u.taxa.toFixed(1)}  score ${u.score.toFixed(3)}  z ${u.z.toFixed(1)}  ${u.diagDominante}`));

console.log('\n6. determinismo (semente fixa)');
const res2 = detectar(unidades);
confere('mesmo recorte devolve os mesmos alertas',
  JSON.stringify(res.alertas.map((u) => u.id)) === JSON.stringify(res2.alertas.map((u) => u.id)));

console.log(`\n${falhas ? `${falhas} FALHA(S)` : 'tudo certo'}`);
if (falhas) process.exit(1);
