/* =========================================================
   dataService.js — buscar bytes e devolver linhas.
   Nenhuma regra de negócio mora aqui.
   ========================================================= */

import { FONTES, MALHA_MUNICIPAL, CODIGO_POR_UF } from './config.js';

/* Os arquivos preparados saem em UTF-8, mas os recursos originais do MAPA já
   vieram em latin-1 em versões anteriores. Tentar UTF-8 e cair para
   Windows-1252 ao encontrar o caractere de substituição é mais confiável do
   que confiar no charset declarado. */
function decodificar(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('�')) return { texto: utf8, charset: 'utf-8' };
  return { texto: new TextDecoder('windows-1252').decode(buffer), charset: 'windows-1252' };
}

function analisar(texto) {
  const r = Papa.parse(texto, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    delimitersToGuess: [';', ',', '\t', '|'],
    transformHeader: (h) => h.trim(),
  });
  return { linhas: r.data, campos: r.meta.fields ?? [], separador: r.meta.delimiter };
}

async function carregarCsv(url) {
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}`);
  const { texto, charset } = decodificar(await resp.arrayBuffer());
  const { linhas, campos, separador } = analisar(texto);
  if (!linhas.length) throw new Error(`Arquivo sem linhas: ${url}`);
  return { linhas, campos, meta: { url, charset, separador, total: linhas.length } };
}

async function carregarJson(url) {
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}`);
  return resp.json();
}

/** Carrega a base inteira, avisando o progresso para a tela de partida. */
export async function carregarTudo(aoProgredir = () => {}) {
  const etapas = [
    ['ufDoencas', 'doenças por UF', () => carregarCsv(FONTES.ufDoencas)],
    ['ufAbates', 'abates por UF', () => carregarCsv(FONTES.ufAbates)],
    ['munDoencas', 'doenças por município', () => carregarCsv(FONTES.munDoencas)],
    ['malhaUF', 'mapa do Brasil', () => carregarJson(FONTES.malhaUF)],
  ];
  const fora = {};
  let feitas = 0;
  await Promise.all(etapas.map(async ([chave, rotulo, fn]) => {
    fora[chave] = await fn();
    feitas += 1;
    aoProgredir(feitas / etapas.length, rotulo);
  }));
  return fora;
}

/* A malha municipal só é baixada quando o usuário entra num estado.
   Baixar as 27 de uma vez seriam alguns megabytes que quase ninguém usa. */
const cacheMalha = new Map();

export async function carregarMalhaMunicipal(uf) {
  const codigo = CODIGO_POR_UF[uf];
  if (!codigo) throw new Error(`UF desconhecida: ${uf}`);
  if (cacheMalha.has(uf)) return cacheMalha.get(uf);
  const promessa = carregarJson(MALHA_MUNICIPAL(codigo))
    .catch((e) => { cacheMalha.delete(uf); throw e; });
  cacheMalha.set(uf, promessa);
  return promessa;
}
