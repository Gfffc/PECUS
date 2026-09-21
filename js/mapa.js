/* =========================================================
   mapa.js — mapa coroplético em SVG, sem biblioteca externa.

   Por que sem D3 ou Leaflet: o painel precisa de uma projeção só, de
   contornos já simplificados pelo IBGE e de um clique. Uma biblioteca de
   mapas traria tiles, zoom geográfico e uma camada de dependência que
   este protótipo não usa. A malha vem em GeoJSON (EPSG:4326) e a
   projeção é equirretangular corrigida pelo cosseno da latitude média —
   suficiente para a escala do Brasil, onde nada aqui depende de medir
   área ou distância.

   As cores saem das variáveis CSS (--mapa-*), então o mapa acompanha a
   troca de tema sem recalcular dado.
   ========================================================= */

import { fmt, NOME_UF } from './config.js';

const NS = 'http://www.w3.org/2000/svg';
const CLASSES = 5;

/* ---------- projeção ---------- */

function coordenadasDe(geometria) {
  if (geometria.type === 'Polygon') return [geometria.coordinates];
  if (geometria.type === 'MultiPolygon') return geometria.coordinates;
  return [];
}

function limites(features) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const f of features) {
    for (const poligono of coordenadasDe(f.geometry)) {
      for (const anel of poligono) {
        for (const [lon, lat] of anel) {
          if (lon < x0) x0 = lon;
          if (lon > x1) x1 = lon;
          if (lat < y0) y0 = lat;
          if (lat > y1) y1 = lat;
        }
      }
    }
  }
  return { x0, y0, x1, y1 };
}

/** Devolve uma função lon/lat → x/y ajustada à caixa de desenho. */
function projetar(features, largura, altura, margem = 4) {
  const { x0, y0, x1, y1 } = limites(features);
  const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
  const lx0 = x0 * k; const lx1 = x1 * k;
  const escala = Math.min((largura - margem * 2) / (lx1 - lx0),
    (altura - margem * 2) / (y1 - y0));
  const dx = (largura - (lx1 - lx0) * escala) / 2;
  const dy = (altura - (y1 - y0) * escala) / 2;
  return (lon, lat) => [
    (lon * k - lx0) * escala + dx,
    (y1 - lat) * escala + dy,
  ];
}

function caminhoDe(geometria, proj) {
  const partes = [];
  for (const poligono of coordenadasDe(geometria)) {
    for (const anel of poligono) {
      if (anel.length < 3) continue;
      let d = '';
      for (let i = 0; i < anel.length; i += 1) {
        const [x, y] = proj(anel[i][0], anel[i][1]);
        d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      partes.push(`${d}Z`);
    }
  }
  return partes.join('');
}

/* ---------- escala de cor ---------- */

function paleta() {
  const s = getComputedStyle(document.documentElement);
  const cor = (n, reserva) => (s.getPropertyValue(n).trim() || reserva);
  return {
    classes: [
      cor('--mapa-1', '#E6EFE7'), cor('--mapa-2', '#A9CDB4'),
      cor('--mapa-3', '#E2C05F'), cor('--mapa-4', '#CE8A4A'), cor('--mapa-5', '#9E3B24'),
    ],
    vazio: cor('--mapa-vazio', '#E8EAE3'),
    traco: cor('--mapa-traco', '#FFFFFF'),
    selecao: cor('--mapa-selecao', '#102A1A'),
  };
}

/**
 * Cortes por quantil, não por intervalo igual: a distribuição de taxas é
 * muito assimétrica e o corte linear jogaria quase tudo na primeira classe.
 */
function cortes(valores) {
  const v = valores.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length < CLASSES) return v.length ? [v[0]] : [];
  const fora = [];
  for (let i = 1; i < CLASSES; i += 1) {
    fora.push(v[Math.floor((i / CLASSES) * (v.length - 1))]);
  }
  return fora;
}

const classeDe = (valor, quebras) => {
  if (!Number.isFinite(valor) || valor <= 0) return -1;
  let i = 0;
  while (i < quebras.length && valor >= quebras[i]) i += 1;
  return i;
};

/* ---------- desenho ---------- */

const estado = {
  alvo: null, geo: null, valores: null, opcoes: null, quebras: [],
};

/**
 * @param {HTMLElement} alvo     contêiner do mapa
 * @param {object} geo           FeatureCollection do IBGE (propriedade codarea)
 * @param {Map} valores          codarea → { nome, taxa, casos, denom, alerta }
 * @param {object} opcoes        { selecionado, aoClicar, rotuloUnidade, nivel }
 */
export function desenhar(alvo, geo, valores, opcoes = {}) {
  estado.alvo = alvo;
  estado.geo = geo;
  estado.valores = valores;
  estado.opcoes = opcoes;

  const features = geo?.features ?? [];
  alvo.innerHTML = '';
  if (!features.length) return;

  const larguraCaixa = alvo.clientWidth || 600;
  const alturaCaixa = alvo.clientHeight || 420;
  const proj = projetar(features, larguraCaixa, alturaCaixa);
  const cores = paleta();
  const quebras = cortes([...valores.values()].map((v) => v.taxa));
  estado.quebras = quebras;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${larguraCaixa} ${alturaCaixa}`);
  svg.setAttribute('class', 'mapa__svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opcoes.descricao
    || 'Mapa com a taxa de casos por procedência');

  for (const f of features) {
    const cod = String(f.properties?.codarea ?? '');
    const dado = valores.get(cod);
    const classe = classeDe(dado?.taxa, quebras);

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', caminhoDe(f.geometry, proj));
    path.setAttribute('fill', classe < 0 ? cores.vazio : cores.classes[Math.min(classe, CLASSES - 1)]);
    path.setAttribute('stroke', cores.traco);
    path.setAttribute('stroke-width', '0.6');
    path.setAttribute('class', 'mapa__area');
    path.dataset.codigo = cod;
    if (dado) path.dataset.nome = dado.nome;
    if (opcoes.selecionado && opcoes.selecionado === cod) {
      path.classList.add('mapa__area--ativa');
      path.setAttribute('stroke', cores.selecao);
      path.setAttribute('stroke-width', '1.8');
    }
    if (dado?.alerta) path.classList.add('mapa__area--alerta');

    if (dado || opcoes.clicavelVazio) {
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      const nome = dado?.nome || cod;
      path.setAttribute('aria-label', dado
        ? `${nome}: ${fmt.taxa(dado.taxa)} ${opcoes.rotuloUnidade ?? ''}`
        : `${nome}: sem registro`);
      path.addEventListener('click', () => opcoes.aoClicar?.(cod, dado));
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          opcoes.aoClicar?.(cod, dado);
        }
      });
    }

    path.addEventListener('pointerenter', (e) => mostrarDica(alvo, e, cod, dado, opcoes));
    path.addEventListener('pointermove', (e) => moverDica(alvo, e));
    path.addEventListener('pointerleave', () => esconderDica(alvo));
    path.addEventListener('focus', (e) => mostrarDica(alvo, e, cod, dado, opcoes, true));
    path.addEventListener('blur', () => esconderDica(alvo));

    svg.append(path);
  }

  alvo.append(svg);
  alvo.append(construirLegenda(quebras, cores, opcoes.rotuloUnidade));
}

/* ---------- legenda ---------- */

function construirLegenda(quebras, cores, unidade) {
  const caixa = document.createElement('div');
  caixa.className = 'mapa__legenda';
  if (!quebras.length) {
    caixa.innerHTML = '<span class="mapa__legenda-nota">Sem dado suficiente para escalonar o mapa.</span>';
    return caixa;
  }
  const faixas = [];
  for (let i = 0; i < CLASSES; i += 1) {
    const de = i === 0 ? 0 : quebras[i - 1];
    const ate = i < quebras.length ? quebras[i] : null;
    faixas.push({ cor: cores.classes[i], rotulo: ate === null ? `${fmt.taxa(de)}+` : `${fmt.taxa(de)}–${fmt.taxa(ate)}` });
  }
  caixa.innerHTML = `
    <span class="mapa__legenda-titulo">${unidade ?? 'taxa'}</span>
    <span class="mapa__legenda-escala">
      ${faixas.map((f) => `<i style="background:${f.cor}" title="${f.rotulo}"></i>`).join('')}
    </span>
    <span class="mapa__legenda-extremos"><span>${faixas[0].rotulo.split('–')[0]}</span><span>${faixas.at(-1).rotulo}</span></span>
    <span class="mapa__legenda-vazio"><i style="background:${cores.vazio}"></i> sem registro</span>`;
  return caixa;
}

/* ---------- dica flutuante ---------- */

function caixaDica(alvo) {
  let d = alvo.querySelector('.mapa__dica');
  if (!d) {
    d = document.createElement('div');
    d.className = 'mapa__dica';
    d.setAttribute('aria-hidden', 'true');
    alvo.append(d);
  }
  return d;
}

function mostrarDica(alvo, evento, cod, dado, opcoes, fixar = false) {
  const d = caixaDica(alvo);
  const nome = dado?.nome ?? NOME_UF[cod] ?? cod;
  d.innerHTML = dado
    ? `<strong>${nome}</strong>
       <span class="mapa__dica-taxa">${fmt.taxa(dado.taxa)} <small>${opcoes.rotuloUnidade ?? ''}</small></span>
       <span class="mapa__dica-linha">${fmt.inteiro(dado.casos)} casos · ${fmt.compacto(dado.denom)} ${opcoes.rotuloDenominador ?? ''}</span>
       ${dado.alerta ? '<span class="mapa__dica-alerta">procedência em alerta</span>' : ''}`
    : `<strong>${nome}</strong><span class="mapa__dica-linha">Sem registro neste recorte.</span>`;
  d.dataset.visivel = 'sim';
  if (fixar) {
    const caixa = evento.target.getBoundingClientRect();
    const pai = alvo.getBoundingClientRect();
    posicionar(alvo, d, caixa.left - pai.left + caixa.width / 2, caixa.top - pai.top);
  } else {
    moverDica(alvo, evento);
  }
}

function moverDica(alvo, evento) {
  const d = alvo.querySelector('.mapa__dica');
  if (!d || d.dataset.visivel !== 'sim') return;
  const pai = alvo.getBoundingClientRect();
  posicionar(alvo, d, evento.clientX - pai.left, evento.clientY - pai.top);
}

function posicionar(alvo, d, x, y) {
  const largura = d.offsetWidth || 180;
  const limite = alvo.clientWidth - largura - 8;
  d.style.left = `${Math.max(8, Math.min(x - largura / 2, limite))}px`;
  d.style.top = `${Math.max(8, y - d.offsetHeight - 14)}px`;
}

function esconderDica(alvo) {
  const d = alvo.querySelector('.mapa__dica');
  if (d) d.dataset.visivel = 'nao';
}

/** Redesenha com a paleta corrente — usado na troca de tema e no resize. */
export function repintar() {
  if (estado.alvo && estado.geo) {
    desenhar(estado.alvo, estado.geo, estado.valores, estado.opcoes);
  }
}
