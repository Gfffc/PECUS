/* =========================================================
   main.js — liga as peças e responde aos filtros.

   Duas decisões de escopo que valem registrar:

   1. O modelo é sempre treinado sobre o Brasil inteiro no período e
      diagnóstico escolhidos, e só depois a tabela é recortada pelo estado
      ou município do filtro. Treinar só dentro de um estado faria o
      município mais problemático do estado parecer normal por falta de
      comparação.

   2. O nível do veredito acompanha o filtro: sem município escolhido, a
      taxa é por cabeça abatida (dado de UF do SIF); com município, é por
      cabeça de rebanho (IBGE), porque o SIF não publica abate municipal.
      Os dois nunca aparecem no mesmo número.
   ========================================================= */

import { carregarTudo, carregarMalhaMunicipal } from './dataService.js';
import {
  normalizarUfDoencas, normalizarUfAbates, normalizarMunicipios,
  filtrarUfDoencas, filtrarUfAbates, filtrarMunicipios,
  porUF, porMes, porMesCalendario, porDiagnostico, porMunicipioAno, porMunicipio,
  mediana, distintos,
} from './transform.js';
import { detectar } from './anomalia.js';
import { graficoSerie, graficoSazonal, graficoDispersao, repintar as repintarGraficos } from './charts.js';
import * as mapa from './mapa.js';
import * as ui from './ui.js';
import { NIVEIS, MIN_ABATIDOS_UF, UF_POR_CODIGO, CODIGO_POR_UF, NOME_UF } from './config.js';

const estado = {
  ufDoencas: [], ufAbates: [], municipios: [],
  anos: [], malhaUF: null, malhaMunicipal: null, ufDaMalha: null,
  escopo: 'Brasil',
};

const CAMPOS_URL = {
  uf: 'f-uf', mun: 'f-municipio', diag: 'f-diagnostico',
  esp: 'f-especie', de: 'f-ano-ini', ate: 'f-ano-fim',
};

const somar = (registros, campo) => registros.reduce((s, r) => s + r[campo], 0);

function percentilDe(valor, valores) {
  const v = valores.filter(Number.isFinite);
  if (!v.length || !Number.isFinite(valor)) return NaN;
  return v.filter((x) => x < valor).length / v.length;
}

/**
 * Diz por que este recorte não sustenta uma taxa — null quando sustenta.
 *
 * Sem esta checagem o painel publicava 252,6 casos por 10 mil em cima de 475
 * cabeças abatidas (Amapá no período inteiro): exatamente o número que
 * MIN_ABATIDOS_UF já mantinha fora do mapa e do ranking, mas que entrava no
 * veredito como se fosse comparável.
 */
function semTaxa(nivelMunicipal, casos, denominador) {
  // zero caso é zero caso, não "mais limpo que o país": 138 dos 206
  // diagnósticos somem em pelo menos um ano do recorte, e antes disso cada um
  // deles devolvia o selo "Dentro do padrão" em cima de nenhum registro
  if (!(casos > 0)) return 'sem-registro';
  if (!(denominador > 0)) return 'sem-denominador';
  // a régua é o tamanho do denominador, não qual estado foi escolhido: assim a
  // checagem também pega recortes de espécie ou período com abate residual
  return !nivelMunicipal && denominador < MIN_ABATIDOS_UF ? 'abate-residual' : null;
}

function descreverEscopo(f) {
  const onde = f.municipio !== 'todos' ? `${f.municipio} (${f.uf})`
    : f.uf !== 'todos' ? `${NOME_UF[f.uf] ?? f.uf}` : 'Brasil';
  const quando = f.anoIni === f.anoFim ? `${f.anoIni}` : `${f.anoIni} a ${f.anoFim}`;
  const oque = f.diagnostico !== 'todos' ? f.diagnostico : 'todos os diagnósticos';
  return `${onde} · ${quando} · ${oque}`;
}

/* ---------- listas dependentes ---------- */

function sincronizarMunicipios(uf) {
  const lista = uf === 'todos'
    ? []
    : distintos(estado.municipios.filter((r) => r.uf === uf), 'municipio');
  ui.preencherSelect('f-municipio', lista,
    uf === 'todos' ? 'Escolha um estado primeiro' : 'Todos os municípios');
  document.getElementById('f-municipio').disabled = uf === 'todos';
}

/** A lista de diagnósticos muda com o nível: o dado municipal cobre só os
    predominantemente bovinos, o de UF cobre o laudo inteiro. */
function sincronizarDiagnosticos(nivelMunicipal) {
  const fonte = nivelMunicipal ? estado.municipios : estado.ufDoencas;
  ui.preencherSelect('f-diagnostico', distintos(fonte, 'diagnostico'), 'Todos os diagnósticos');
}

/* ---------- estado na URL ---------- */

function gravarURL(f) {
  const p = new URLSearchParams();
  if (f.uf !== 'todos') p.set('uf', f.uf);
  if (f.municipio !== 'todos') p.set('mun', f.municipio);
  if (f.diagnostico !== 'todos') p.set('diag', f.diagnostico);
  if (f.especie !== 'todos') p.set('esp', f.especie);
  if (f.anoIni !== estado.anos[0]) p.set('de', f.anoIni);
  if (f.anoFim !== estado.anos.at(-1)) p.set('ate', f.anoFim);
  history.replaceState(null, '', p.toString() ? `#${p}` : location.pathname);
}

function aplicarURL() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (![...p.keys()].length) return;
  const definir = (chave) => {
    const valor = p.get(chave);
    if (valor == null) return;
    const select = document.getElementById(CAMPOS_URL[chave]);
    if ([...select.options].some((o) => o.value === valor)) select.value = valor;
  };
  definir('uf');
  sincronizarMunicipios(document.getElementById('f-uf').value);
  definir('mun');
  sincronizarDiagnosticos(document.getElementById('f-municipio').value !== 'todos');
  for (const chave of ['diag', 'esp', 'de', 'ate']) definir(chave);
}

/* ---------- ciclo de atualização ---------- */

function atualizar() {
  const f = ui.lerFiltros();
  const nivelMunicipal = f.municipio !== 'todos';
  const nivel = nivelMunicipal ? NIVEIS.municipio : NIVEIS.uf;

  estado.escopo = descreverEscopo(f);
  gravarURL(f);
  ui.sincronizarEstadoFiltros(removerFiltro);
  ui.ajustarFiltroEspecie(nivelMunicipal);

  /* ---- nível UF: métrica original, casos por cabeça abatida ---- */
  const ufDoencasF = filtrarUfDoencas(estado.ufDoencas, f);
  const ufAbatesF = filtrarUfAbates(estado.ufAbates, f);
  const nacional = { ...f, uf: 'todos', municipio: 'todos' };
  const ufDoencasN = filtrarUfDoencas(estado.ufDoencas, nacional);
  const ufAbatesN = filtrarUfAbates(estado.ufAbates, nacional);
  const linhasUF = porUF(ufDoencasN, ufAbatesN, MIN_ABATIDOS_UF);

  /* ---- nível município: casos por cabeça de rebanho ---- */
  const munN = filtrarMunicipios(estado.municipios, { ...nacional, diagnostico: f.diagnostico });
  const unidadesN = porMunicipioAno(munN);
  const resultado = detectar(unidadesN);

  const noRecorte = (u) => (f.uf === 'todos' || u.uf === f.uf)
    && (f.municipio === 'todos' || u.municipio === f.municipio);
  const unidadesRecorte = resultado.unidades.filter(noRecorte);
  const alertasRecorte = resultado.alertas.filter(noRecorte);

  /* ---- veredito, no nível que o filtro determina ---- */
  let casos; let denominador; let taxasComparaveis;
  if (nivelMunicipal) {
    casos = unidadesRecorte.reduce((s, u) => s + u.casos, 0);
    denominador = unidadesRecorte.reduce((s, u) => s + u.rebanho, 0);
    taxasComparaveis = resultado.unidades.map((u) => u.taxa);
  } else {
    casos = somar(ufDoencasF, 'casos');
    denominador = somar(ufAbatesF, 'abatidos');
    taxasComparaveis = linhasUF.map((l) => l.taxa);
  }
  const motivo = semTaxa(nivelMunicipal, casos, denominador);
  const taxa = !motivo ? (casos / denominador) * 10000 : NaN;
  const medianaNacional = mediana(taxasComparaveis);

  const municipiosDistintos = new Set(
    filtrarMunicipios(estado.municipios, f).map((r) => `${r.uf}|${r.municipio}`)).size;

  ui.renderVeredito({
    escopo: estado.escopo,
    nivel,
    taxa,
    medianaNacional,
    percentil: percentilDe(taxa, taxasComparaveis),
    emAlerta: nivelMunicipal && alertasRecorte.length > 0,
    casos,
    denominador,
    municipios: municipiosDistintos,
    alertas: alertasRecorte.length,
    motivo,
    minAbatidos: MIN_ABATIDOS_UF,
  });

  /* ---- o que puxa a taxa: sempre no nível exibido ---- */
  ui.renderDiagnosticos(
    nivelMunicipal
      ? porDiagnostico(filtrarMunicipios(estado.municipios, f), denominador)
      : porDiagnostico(ufDoencasF, denominador),
    (diagnostico) => {
      document.getElementById('f-diagnostico').value = diagnostico;
      atualizarComAviso();
    });

  ui.renderNotaModelo(resultado.diagnostico);
  ui.renderTabela(alertasRecorte, mediana(resultado.unidades.map((u) => u.taxa)));

  /* ---- mapa e ranking ---- */
  desenharMapa(f, linhasUF, resultado.unidades);

  /* ---- séries temporais: só existem no nível UF (o municipal é anual) ---- */
  graficoSerie(porMes(ufDoencasF, ufAbatesF));
  graficoSazonal(porMesCalendario(ufDoencasF, ufAbatesF));
  graficoDispersao(unidadesRecorte.length >= 10 ? unidadesRecorte : resultado.unidades);

  document.getElementById('serie-nota').textContent = nivelMunicipal
    ? `Série mensal de ${NOME_UF[f.uf] ?? f.uf} — o dado municipal do SIF é anual, então a evolução mensal é a do estado.`
    : 'Taxa mensal no recorte escolhido, por 10 mil cabeças abatidas.';
}

/* ---------- mapa ---------- */

function desenharMapa(f, linhasUF, unidades) {
  const alvo = document.getElementById('mapa');
  const dentroDeUmEstado = f.uf !== 'todos';
  document.getElementById('mapa-voltar').hidden = !dentroDeUmEstado;

  if (!dentroDeUmEstado) {
    estado.malhaMunicipal = null;
    estado.ufDaMalha = null;

    const valores = new Map();
    for (const l of linhasUF) {
      valores.set(String(CODIGO_POR_UF[l.uf]), {
        nome: NOME_UF[l.uf] ?? l.uf, taxa: l.taxa, casos: l.casos, denom: l.abatidos,
      });
    }
    ui.renderNotaMapa('Mapa da procedência — Brasil',
      'Casos por 10 mil cabeças abatidas sob inspeção federal. Clique num estado para entrar nos municípios.');
    mapa.desenhar(alvo, estado.malhaUF, valores, {
      rotuloUnidade: NIVEIS.uf.curta,
      rotuloDenominador: 'abatidas',
      descricao: 'Mapa do Brasil com a taxa de casos por 10 mil cabeças abatidas em cada estado de procedência',
      aoClicar: (codigo) => {
        const uf = UF_POR_CODIGO[Number(codigo)];
        if (!uf) return;
        document.getElementById('f-uf').value = uf;
        sincronizarMunicipios(uf);
        atualizarComAviso();
      },
    });

    ui.renderRanking(
      linhasUF.map((l) => ({ chave: l.uf, nome: `${l.uf} — ${NOME_UF[l.uf] ?? l.uf}`, taxa: l.taxa })),
      {
        titulo: 'Estados de procedência',
        nota: `Casos por 10 mil abatidas. Estados com menos de ${MIN_ABATIDOS_UF.toLocaleString('pt-BR')} cabeças no período ficam de fora.`,
        selecionado: null,
        unidade: NIVEIS.uf.curta,
        aoClicar: (l) => {
          document.getElementById('f-uf').value = l.chave;
          sincronizarMunicipios(l.chave);
          atualizarComAviso();
        },
      });
    return;
  }

  /* dentro de um estado: coroplético municipal pelo rebanho */
  const doEstado = unidades.filter((u) => u.uf === f.uf);
  const agregados = porMunicipio(doEstado);
  const valores = new Map();
  for (const m of agregados) {
    if (!m.codigo) continue;
    valores.set(m.codigo, {
      nome: m.municipio, taxa: m.taxa, casos: m.casos, denom: m.rebanho, alerta: m.alertas > 0,
    });
  }

  ui.renderNotaMapa(`Municípios de ${NOME_UF[f.uf] ?? f.uf}`,
    'Casos por 10 mil cabeças do rebanho bovino (IBGE/PPM). Município em cinza não teve registro no recorte.');
  ui.renderRanking(
    agregados.map((m) => ({ chave: m.municipio, nome: m.municipio, taxa: m.taxa })),
    {
      titulo: `Municípios de ${f.uf}`,
      nota: 'Casos por 10 mil cabeças do rebanho. Clique para filtrar.',
      selecionado: f.municipio === 'todos' ? null : f.municipio,
      unidade: NIVEIS.municipio.curta,
      aoClicar: (l) => {
        document.getElementById('f-municipio').value = l.chave;
        sincronizarDiagnosticos(true);
        atualizarComAviso();
      },
    });

  const selecionado = f.municipio === 'todos'
    ? null
    : (agregados.find((m) => m.municipio === f.municipio)?.codigo ?? null);

  const pintar = (malha) => mapa.desenhar(alvo, malha, valores, {
    selecionado,
    rotuloUnidade: NIVEIS.municipio.curta,
    rotuloDenominador: 'no rebanho',
    descricao: `Mapa de ${NOME_UF[f.uf] ?? f.uf} com a taxa de casos por 10 mil cabeças do rebanho em cada município`,
    aoClicar: (codigo, dado) => {
      if (!dado) return;
      document.getElementById('f-municipio').value = dado.nome;
      sincronizarDiagnosticos(true);
      atualizarComAviso();
    },
  });

  if (estado.ufDaMalha === f.uf && estado.malhaMunicipal) {
    pintar(estado.malhaMunicipal);
    return;
  }
  alvo.innerHTML = '<p class="mapa__aviso">Baixando o contorno dos municípios no IBGE…</p>';
  carregarMalhaMunicipal(f.uf)
    .then((malha) => {
      estado.malhaMunicipal = malha;
      estado.ufDaMalha = f.uf;
      // o usuário pode ter trocado de estado enquanto a malha vinha
      if (ui.lerFiltros().uf === f.uf) pintar(malha);
    })
    .catch((e) => {
      console.error(e);
      alvo.innerHTML = '<p class="mapa__aviso">Não foi possível baixar o contorno dos municípios '
        + 'no IBGE. O ranking ao lado continua válido.</p>';
    });
}

/** O modelo leva algumas centenas de ms: cede um quadro para a barra de
    progresso aparecer antes de travar a thread. */
function atualizarComAviso() {
  ui.marcarCarregando(true);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      atualizar();
    } catch (e) {
      console.error(e);
      ui.mostrarErro(`Falha ao recalcular o painel. ${e.message}`);
    } finally {
      ui.marcarCarregando(false);
    }
  }));
}

function removerFiltro(id) {
  document.getElementById(id).value = 'todos';
  if (id === 'f-uf') sincronizarMunicipios('todos');
  if (id === 'f-uf' || id === 'f-municipio') {
    sincronizarDiagnosticos(document.getElementById('f-municipio').value !== 'todos');
  }
  atualizarComAviso();
}

/* ---------- gaveta, tema e ações ---------- */

function abrirFiltros(aberta) {
  document.getElementById('filtros').dataset.aberta = aberta ? 'sim' : 'nao';
  document.getElementById('veu').dataset.aberto = aberta ? 'sim' : 'nao';
  document.getElementById('abrir-filtros').setAttribute('aria-expanded', String(aberta));
  document.body.style.overflow = aberta && window.innerWidth <= 960 ? 'hidden' : '';
}

function alternarTema() {
  const escuroAgora = document.documentElement.dataset.tema
    ? document.documentElement.dataset.tema === 'escuro'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const novo = escuroAgora ? 'claro' : 'escuro';
  document.documentElement.dataset.tema = novo;
  try { localStorage.setItem('sigsif-tema', novo); } catch (e) { /* sem persistência */ }
  repintarGraficos();
  mapa.repintar();
}

/** Copia o endereço com o recorte atual. O feedback fica no próprio botão. */
async function copiarLink() {
  const botao = document.getElementById('btn-link');
  try {
    await navigator.clipboard.writeText(location.href);
    botao.dataset.copiado = 'sim';
    botao.title = 'Link copiado';
    setTimeout(() => {
      delete botao.dataset.copiado;
      botao.title = 'Copiar link com os filtros atuais';
    }, 1600);
  } catch (e) {
    ui.mostrarErro(`O navegador não permitiu copiar automaticamente. Copie da barra de endereço: ${location.href}`);
  }
}

function ligarEventos() {
  document.getElementById('f-uf').addEventListener('change', (e) => {
    sincronizarMunicipios(e.target.value);
    sincronizarDiagnosticos(false);
    atualizarComAviso();
  });
  document.getElementById('f-municipio').addEventListener('change', (e) => {
    sincronizarDiagnosticos(e.target.value !== 'todos');
    atualizarComAviso();
  });
  for (const id of ['f-diagnostico', 'f-especie', 'f-ano-ini', 'f-ano-fim']) {
    document.getElementById(id).addEventListener('change', atualizarComAviso);
  }

  document.getElementById('f-limpar').addEventListener('click', () => {
    for (const id of ['f-uf', 'f-diagnostico', 'f-especie']) {
      document.getElementById(id).value = 'todos';
    }
    sincronizarMunicipios('todos');
    sincronizarDiagnosticos(false);
    ui.preencherAnos(estado.anos, estado.anos[0], estado.anos.at(-1));
    atualizarComAviso();
  });

  document.getElementById('filtros').addEventListener('submit', (e) => {
    e.preventDefault();
    atualizarComAviso();
  });

  document.getElementById('mapa-voltar').addEventListener('click', () => {
    document.getElementById('f-uf').value = 'todos';
    sincronizarMunicipios('todos');
    sincronizarDiagnosticos(false);
    atualizarComAviso();
  });

  document.getElementById('abrir-filtros').addEventListener('click', () => {
    abrirFiltros(document.getElementById('filtros').dataset.aberta !== 'sim');
  });
  document.getElementById('fechar-filtros').addEventListener('click', () => abrirFiltros(false));
  document.getElementById('veu').addEventListener('click', () => abrirFiltros(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') abrirFiltros(false);
  });

  let redimensionando;
  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) { abrirFiltros(false); document.body.style.overflow = ''; }
    clearTimeout(redimensionando);
    redimensionando = setTimeout(() => mapa.repintar(), 180);
  });

  document.getElementById('btn-tema').addEventListener('click', alternarTema);
  document.getElementById('btn-imprimir').addEventListener('click', () => window.print());
  document.getElementById('btn-link').addEventListener('click', copiarLink);
  document.getElementById('btn-csv').addEventListener('click', () => ui.baixarCSV(estado.escopo));
  document.getElementById('erro-fechar').addEventListener('click', ui.ocultarErro);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!document.documentElement.dataset.tema) { repintarGraficos(); mapa.repintar(); }
  });

  ui.ligarOrdenacao();
}

/* ---------- partida ---------- */

async function iniciar() {
  ui.marcarCarregando(true);
  try {
    const bruto = await carregarTudo(ui.progresso);

    const d = normalizarUfDoencas(bruto.ufDoencas);
    const a = normalizarUfAbates(bruto.ufAbates);
    const m = normalizarMunicipios(bruto.munDoencas);
    estado.ufDoencas = d.registros;
    estado.ufAbates = a.registros;
    estado.municipios = m.registros;
    estado.malhaUF = bruto.malhaUF;
    estado.anos = [...new Set(estado.ufDoencas.map((r) => r.ano))].sort((x, y) => x - y);

    if (!estado.ufDoencas.length || !estado.ufAbates.length || !estado.municipios.length) {
      throw new Error('Os arquivos foram lidos, mas nenhuma linha sobreviveu à validação.');
    }

    ui.preencherSelect('f-uf', distintos(estado.ufDoencas, 'uf'), 'Todos os estados');
    sincronizarMunicipios('todos');
    sincronizarDiagnosticos(false);
    /* O nível UF é casos por cabeça ABATIDA: espécie sem abate publicado não
       produz taxa nenhuma. O SIF traz doença de bubalino mas o abate bubalino
       do período inteiro são 29 mil cabeças no país, nenhuma UF chegando ao
       mínimo da comparação — oferecer o filtro só devolveria tela vazia.
       Em "Todas" os bubalinos continuam contados nos dois lados da divisão. */
    const comDenominador = new Set(distintos(estado.ufAbates, 'especie'));
    ui.preencherSelect('f-especie',
      distintos(estado.ufDoencas, 'especie').filter((e) => comDenominador.has(e)), 'Todas');
    ui.preencherAnos(estado.anos, estado.anos[0], estado.anos.at(-1));
    aplicarURL();

    const nf = new Intl.NumberFormat('pt-BR');
    ui.renderRodape(
      `${nf.format(d.registros.length)} linhas de doença por UF, ${nf.format(a.registros.length)} de abate `
      + `e ${nf.format(m.registros.length)} de doença por município, cobrindo `
      + `${estado.anos[0]}–${estado.anos.at(-1)}. Rebanho municipal da PPM/IBGE. `
      + `${nf.format(d.descartadas + m.descartadas)} linhas descartadas na validação.`);

    ligarEventos();
    atualizar();
    ui.ocultarErro();
    ui.fecharPartida();
  } catch (e) {
    console.error(e);
    ui.fecharPartida();
    ui.mostrarErro(`Não foi possível montar o painel. ${e.message} `
      + 'Confira se os arquivos estão em data/ (rode data/preparar_dados.py) '
      + 'e se a página está sendo servida por um servidor HTTP.');
  } finally {
    ui.marcarCarregando(false);
  }
}

iniciar();
