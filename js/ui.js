/* =========================================================
   ui.js — tudo que toca no DOM.
   Nenhuma regra de negócio mora aqui: recebe dado pronto e pinta.
   ========================================================= */

import { FAIXAS, fmt, NOME_UF } from './config.js';

const el = (id) => document.getElementById(id);

/** Escapa antes de entrar em innerHTML: o dado vem de CSV de terceiro. */
function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- partida ---------- */

export function progresso(fracao, rotulo) {
  const barra = el('partida-barra');
  if (barra) barra.style.width = `${Math.round(fracao * 100)}%`;
  if (rotulo) el('partida-nota').textContent = `${rotulo} carregado…`;
}

export function fecharPartida() {
  const p = el('partida');
  if (!p) return;
  p.dataset.pronto = 'sim';
  setTimeout(() => p.remove(), 400);
}

/* ---------- selects ---------- */

export function preencherSelect(id, valores, rotuloTodos) {
  const select = el(id);
  const anterior = select.value;
  select.innerHTML = '';
  if (rotuloTodos) {
    const opt = document.createElement('option');
    opt.value = 'todos';
    opt.textContent = rotuloTodos;
    select.append(opt);
  }
  for (const v of valores) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = id === 'f-uf' ? `${v} — ${NOME_UF[v] ?? v}` : v;
    select.append(opt);
  }
  select.value = valores.includes(anterior) || anterior === 'todos'
    ? anterior
    : (rotuloTodos ? 'todos' : valores[0]);
}

export function preencherAnos(anos, ini, fim) {
  for (const [id, valor] of [['f-ano-ini', ini], ['f-ano-fim', fim]]) {
    const select = el(id);
    select.innerHTML = '';
    for (const a of anos) {
      const opt = document.createElement('option');
      opt.value = String(a);
      opt.textContent = String(a);
      select.append(opt);
    }
    select.value = String(valor);
  }
}

export function lerFiltros() {
  let ini = Number(el('f-ano-ini').value);
  let fim = Number(el('f-ano-fim').value);
  if (ini > fim) [ini, fim] = [fim, ini];
  return {
    uf: el('f-uf').value,
    municipio: el('f-municipio').value,
    diagnostico: el('f-diagnostico').value,
    especie: el('f-especie').value,
    anoIni: ini,
    anoFim: fim,
  };
}

/* ---------- fichas de filtro ativo ---------- */

const ROTULO_CAMPO = {
  'f-uf': 'Estado',
  'f-municipio': 'Município',
  'f-diagnostico': 'Diagnóstico',
  'f-especie': 'Espécie',
};

export function sincronizarEstadoFiltros(aoRemover) {
  const chips = el('chips');
  chips.innerHTML = '';
  let ativos = 0;

  for (const [id, rotulo] of Object.entries(ROTULO_CAMPO)) {
    const select = el(id);
    const ativo = select.value !== 'todos';
    select.closest('.select-caixa')?.setAttribute('data-ativo', ativo ? 'sim' : 'nao');
    if (!ativo) continue;
    ativos += 1;

    const li = document.createElement('li');
    li.className = 'chip';
    li.innerHTML = `<span>${escapar(rotulo)}: ${escapar(select.value)}</span>`;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.innerHTML = '&times;';
    botao.setAttribute('aria-label', `Remover o filtro ${rotulo}: ${select.value}`);
    botao.addEventListener('click', () => aoRemover(id));
    li.append(botao);
    chips.append(li);
  }

  el('f-limpar').disabled = ativos === 0;
  el('abrir-filtros').dataset.ativos = String(ativos);
  el('conta-filtros').textContent = String(ativos);
  return ativos;
}

/** No nível municipal o SIF não traz espécie: o filtro fica inerte e explicado. */
export function ajustarFiltroEspecie(nivelMunicipal) {
  el('f-especie').disabled = nivelMunicipal;
  el('nota-especie').hidden = !nivelMunicipal;
  el('campo-especie').dataset.inerte = nivelMunicipal ? 'sim' : 'nao';
}

/* ---------- veredito ---------- */

function classificar(razao) {
  if (!Number.isFinite(razao)) return FAIXAS[1];
  return FAIXAS.find((f) => razao <= f.ate) ?? FAIXAS.at(-1);
}

const FRASES = {
  baixo: 'Histórico sanitário mais limpo que o do país.',
  tipico: 'Histórico sanitário dentro do padrão do país.',
  atencao: 'Registro acima do que se vê no país.',
  alto: 'Registro muito acima do que se vê no país.',
};

const SELOS = {
  baixo: 'Abaixo da mediana',
  tipico: 'Dentro do padrão',
  atencao: 'Merece atenção',
  alto: 'Muito acima',
};

/* Quando o recorte não sustenta uma taxa, a tela diz qual é o impedimento.
   Antes os três casos caíam todos em "Sem registro de doença", que era falso
   nos dois últimos: havia caso registrado, o que faltava era denominador. */
const SEM_TAXA = {
  'sem-registro': {
    selo: 'Sem registro',
    frase: 'Sem registro de doença para este recorte.',
    legenda: () => 'A inspeção federal não registrou nenhum caso nesta procedência e período. '
      + 'Nenhum registro não é o mesmo que rebanho sadio: pode ser que o gado daqui não tenha '
      + 'passado por abate sob inspeção federal.',
  },
  'sem-denominador': {
    selo: 'Sem denominador',
    frase: 'Há casos registrados, mas não há abate publicado para virar taxa.',
    legenda: () => 'O SIF não publica abate para esta espécie no recorte, e contagem bruta '
      + 'de casos não se compara entre procedências. O número de casos fica abaixo, sem régua.',
  },
  'abate-residual': {
    selo: 'Abate residual',
    frase: 'Abate federal pequeno demais para sustentar uma taxa.',
    legenda: (min) => `Menos de <b>${fmt.inteiro(min)}</b> cabeças abatidas sob inspeção federal `
      + 'no período: sobre um denominador desse tamanho um único lote move a taxa inteira. '
      + 'Esta procedência fica fora da comparação, como já ficava no mapa e no ranking.',
  },
};

export function renderVeredito({ escopo, nivel, taxa, medianaNacional, percentil, emAlerta,
  casos, denominador, municipios, alertas, motivo, minAbatidos }) {
  const razao = Number.isFinite(medianaNacional) && medianaNacional > 0 ? taxa / medianaNacional : NaN;
  const faixa = classificar(razao);
  const impedimento = motivo ? SEM_TAXA[motivo] : null;
  const temDado = !impedimento && Number.isFinite(taxa);

  // sem faixa reconhecida o CSS cai no acento neutro: nada de verde ou vermelho
  el('veredito').dataset.faixa = temDado ? faixa.chave : 'indefinido';
  el('v-escopo').querySelector('span').textContent = escopo;
  el('v-selo-texto').textContent = temDado ? SELOS[faixa.chave] : impedimento.selo;
  el('v-frase').textContent = temDado ? FRASES[faixa.chave] : impedimento.frase;
  el('v-taxa').textContent = temDado ? fmt.taxa(taxa) : '—';
  el('v-unidade').textContent = nivel.unidade;

  /* Sem taxa não há posição na régua, e o marcador parado no centro leria
     como "dentro do padrão". A trilha some; a explicação continua. */
  const regua = el('v-regua');
  regua.querySelector('.regua__trilho').hidden = !temDado;
  regua.setAttribute('aria-label', temDado
    ? 'Posição desta procedência na distribuição nacional'
    : 'Sem posição na distribuição nacional para este recorte');

  const marca = el('v-marca');
  const pos = Number.isFinite(percentil) ? Math.min(97, Math.max(3, percentil * 100)) : 50;
  marca.style.left = `${pos}%`;
  marca.dataset.pos = pos < 18 ? 'inicio' : pos > 82 ? 'fim' : 'meio';
  el('v-marca-rotulo').textContent = temDado ? 'esta procedência' : '';

  if (impedimento) {
    el('v-legenda').innerHTML = impedimento.legenda(minAbatidos);
  } else {
    const comparacao = Number.isFinite(razao)
      ? `<b>${fmt.razao(razao)}×</b> a mediana nacional do recorte (${fmt.taxa(medianaNacional)} ${escapar(nivel.curta)}).`
      : 'Sem base de comparação para este recorte.';
    const posicao = Number.isFinite(percentil)
      ? ` Fica acima de <b>${Math.round(percentil * 100)}%</b> das procedências comparáveis.`
      : '';
    const aviso = emAlerta ? ' <b>O modelo marcou esta procedência como fora do padrão.</b>' : '';
    el('v-legenda').innerHTML = `${escapar(faixa.rotulo)}. ${comparacao}${posicao}${aviso}`;
  }

  el('i-casos').textContent = fmt.inteiro(casos);
  el('i-denominador').textContent = fmt.inteiro(denominador);
  el('i-denominador-rotulo').textContent = nivel.chave === 'uf'
    ? 'cabeças abatidas' : 'cabeças no rebanho';
  el('i-municipios').textContent = fmt.inteiro(municipios);
  el('i-municipios').nextElementSibling.textContent =
    municipios === 1 ? 'município de origem' : 'municípios de origem';
  el('i-alertas').textContent = fmt.inteiro(alertas);
  el('i-alertas').nextElementSibling.textContent =
    alertas === 1 ? 'procedência em alerta' : 'procedências em alerta';
}

/* ---------- ranking lateral do mapa ---------- */

export function renderRanking(linhas, { titulo, nota, selecionado, unidade, aoClicar }) {
  el('ranking-titulo').textContent = titulo;
  el('ranking-nota').textContent = nota;
  const lista = el('ranking');
  lista.innerHTML = '';
  if (!linhas.length) {
    lista.innerHTML = '<li class="tabela__vazio">Sem procedência com volume suficiente neste recorte.</li>';
    return;
  }
  const maior = linhas[0].taxa || 1;
  for (const [i, l] of linhas.slice(0, 30).entries()) {
    const li = document.createElement('li');
    li.className = 'ranking__item';
    if (l.chave === selecionado) li.classList.add('ranking__item--ativo');
    li.innerHTML = `
      <span class="ranking__pos">${i + 1}</span>
      <span class="ranking__nome" title="${escapar(l.nome)}">${escapar(l.nome)}</span>
      <span class="ranking__barra"><i style="width:${Math.max(3, (l.taxa / maior) * 100)}%"></i></span>
      <span class="ranking__valor">${fmt.taxa(l.taxa)}</span>`;
    if (aoClicar) {
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', `${l.nome}: ${fmt.taxa(l.taxa)} ${unidade}`);
      li.addEventListener('click', () => aoClicar(l));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aoClicar(l); }
      });
    }
    lista.append(li);
  }
}

/* ---------- o que puxa a taxa ---------- */

export function renderDiagnosticos(linhas, aoClicar) {
  const lista = el('lista-diagnosticos');
  lista.innerHTML = '';
  if (!linhas.length) {
    lista.innerHTML = '<li class="tabela__vazio">Nenhum diagnóstico registrado neste recorte.</li>';
    return;
  }
  const maior = linhas[0].taxa || 1;
  for (const l of linhas.slice(0, 8)) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="puxa__posicao" aria-hidden="true"></span>
      <span class="puxa__nome" title="${escapar(l.diagnostico)}">${escapar(l.diagnostico)}</span>
      <span class="puxa__barra"><i style="width:${Math.max(2, (l.taxa / maior) * 100)}%"></i></span>
      <span class="puxa__valor"><b>${fmt.taxa(l.taxa)}</b><small>${fmt.inteiro(l.casos)} casos</small></span>`;
    if (aoClicar) {
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', `Filtrar por ${l.diagnostico}`);
      li.addEventListener('click', () => aoClicar(l.diagnostico));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aoClicar(l.diagnostico); }
      });
    }
    lista.append(li);
  }
}

/* ---------- tabela de alertas, com ordenação ---------- */

let alertasAtuais = [];
let medianaAtual = NaN;
let ordem = { col: 'taxa', desc: true };

const grauForte = (u) => u.score >= 0.65 || u.z >= 3;

const VALOR_COLUNA = {
  local: (u) => `${u.municipio}/${u.uf}`,
  ano: (u) => u.ano,
  taxa: (u) => u.taxa,
  razao: (u) => u.taxa,
  rebanho: (u) => u.rebanho,
  diag: (u) => u.diagDominante,
  grau: (u) => (grauForte(u) ? 1 : 0) + (Number.isFinite(u.score) ? u.score : 0),
};

export function renderTabela(alertas, medianaNacional) {
  alertasAtuais = alertas;
  medianaAtual = medianaNacional;
  el('btn-csv').disabled = !alertas.length;
  desenharLinhas();
}

function ordenadas() {
  const chave = VALOR_COLUNA[ordem.col] ?? VALOR_COLUNA.taxa;
  return alertasAtuais.slice().sort((a, b) => {
    const x = chave(a);
    const y = chave(b);
    const cmp = typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y;
    return ordem.desc ? -cmp : cmp;
  });
}

function desenharLinhas() {
  const tabela = el('tabela-alertas');
  const corpo = tabela.querySelector('tbody');
  corpo.innerHTML = '';

  for (const th of tabela.querySelectorAll('thead th')) {
    if (th.dataset.col === ordem.col) th.setAttribute('aria-sort', ordem.desc ? 'descending' : 'ascending');
    else th.removeAttribute('aria-sort');
  }

  if (!alertasAtuais.length) {
    corpo.innerHTML = '<tr><td colspan="7" class="tabela__vazio">'
      + 'Nenhuma procedência fora do padrão neste recorte.</td></tr>';
    return;
  }

  for (const u of ordenadas().slice(0, 30)) {
    const razao = medianaAtual > 0 ? u.taxa / medianaAtual : NaN;
    const forte = grauForte(u);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="tabela__local">${escapar(u.municipio)}</span><span class="tabela__uf">${escapar(u.uf)}</span></td>
      <td>${u.ano}</td>
      <td class="num">${fmt.taxa(u.taxa)}</td>
      <td class="num">${fmt.razao(razao)}×</td>
      <td class="num">${fmt.compacto(u.rebanho)}</td>
      <td>${escapar(u.diagDominante)} <span class="tabela__share">${Math.round(u.shareDominante * 100)}%</span></td>
      <td class="num"><span class="grau ${forte ? 'grau--alto' : 'grau--medio'}">${forte ? 'destacado' : 'moderado'}</span></td>`;
    corpo.append(tr);
  }
}

export function ligarOrdenacao() {
  for (const th of el('tabela-alertas').querySelectorAll('thead th')) {
    th.querySelector('.ord')?.addEventListener('click', () => {
      const col = th.dataset.col;
      ordem = ordem.col === col ? { col, desc: !ordem.desc } : { col, desc: true };
      desenharLinhas();
    });
  }
}

/** Exporta o recorte em CSV com separador ';' e BOM, para abrir direto no Excel pt-BR. */
export function baixarCSV(escopo) {
  if (!alertasAtuais.length) return;
  const cab = ['municipio', 'uf', 'codigo_ibge', 'ano', 'taxa_por_10mil_rebanho',
    'razao_mediana_nacional', 'casos', 'rebanho', 'diagnostico_dominante',
    'participacao_dominante_pct', 'score', 'z_robusto', 'grau'];
  const br = (v, casas) => (Number.isFinite(v) ? v.toFixed(casas).replace('.', ',') : '');
  const linhas = ordenadas().map((u) => [
    u.municipio, u.uf, u.codigo, u.ano,
    br(u.taxa, 2),
    br(medianaAtual > 0 ? u.taxa / medianaAtual : NaN, 2),
    u.casos, u.rebanho, u.diagDominante,
    Math.round(u.shareDominante * 100),
    br(u.score, 4), br(u.z, 2),
    grauForte(u) ? 'destacado' : 'moderado',
  ]);
  const texto = [cab, ...linhas]
    .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const url = URL.createObjectURL(new Blob([`﻿${texto}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `sigsif-alertas-${escopo.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- textos auxiliares ---------- */

export function renderNotaModelo(diag) {
  if (!diag.suficiente) {
    el('modelo-nota').textContent = 'Recorte pequeno demais para rodar o modelo: '
      + 'são necessárias ao menos 20 procedências com rebanho relevante. Amplie o período ou o estado.';
    return;
  }
  const conc = Number.isFinite(diag.concordancia) ? `${Math.round(diag.concordancia * 100)}%` : '—';
  el('modelo-nota').textContent =
    `Isolation Forest sobre ${fmt.inteiro(diag.treinadas)} pares de município e ano, `
    + 'usando taxa, tamanho do rebanho, desvio em relação ao estado, desvio em relação à própria '
    + `história e concentração em um único diagnóstico. ${fmt.inteiro(diag.noModelo)} procedências `
    + `marcadas pelo modelo, ${fmt.inteiro(diag.naBase)} pela regra simples de desvio (mediana e MAD); `
    + `as duas coincidem em ${conc} dos casos. ${fmt.inteiro(diag.ignoradas)} ficaram de fora por `
    + 'rebanho pequeno demais para a taxa ser estável.';
}

export function renderNotaMapa(titulo, nota) {
  el('mapa-titulo').textContent = titulo;
  el('mapa-nota').textContent = nota;
}

export function renderRodape(texto) {
  el('rodape-tecnico').textContent = texto;
}

export function marcarCarregando(ativo) {
  document.body.dataset.estado = ativo ? 'carregando' : 'pronto';
}

export function mostrarErro(mensagem) {
  const caixa = el('erro');
  caixa.hidden = false;
  el('erro-texto').textContent = mensagem;
}

export function ocultarErro() {
  el('erro').hidden = true;
}
