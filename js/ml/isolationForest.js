/* =========================================================
   isolationForest.js — Isolation Forest (Liu, Ting & Zhou, 2008)
   em JavaScript puro, sem dependência externa.

   Por que este modelo e não um classificador: não existe rótulo de
   "procedência arriscada" no dado do MAPA. Não há como treinar de forma
   supervisionada. Isolation Forest é não supervisionado e isola o ponto
   raro pelo número de cortes aleatórios necessários para separá-lo do
   resto — poucos cortes, ponto atípico.

   Roda no navegador porque a unidade de análise é município × ano
   (algumas milhares de linhas), não a linha bruta do CSV.
   ========================================================= */

/** Gerador pseudoaleatório com semente: o mesmo recorte devolve o mesmo alerta. */
function mulberry32(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Comprimento médio de caminho numa BST com n nós — normaliza o score. */
function c(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  const H = Math.log(n - 1) + 0.5772156649;
  return 2 * H - (2 * (n - 1)) / n;
}

function construir(indices, X, profundidade, limite, rand) {
  if (profundidade >= limite || indices.length <= 1) {
    return { folha: true, tamanho: indices.length };
  }
  const nAtributos = X[0].length;
  // sorteia um atributo que tenha variação na amostra; sem variação, vira folha
  const ordem = [];
  for (let i = 0; i < nAtributos; i += 1) ordem.push(i);
  for (let i = ordem.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  }

  for (const atributo of ordem) {
    let min = Infinity;
    let max = -Infinity;
    for (const i of indices) {
      const v = X[i][atributo];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min <= 1e-12) continue;

    const corte = min + rand() * (max - min);
    const esq = [];
    const dir = [];
    for (const i of indices) (X[i][atributo] < corte ? esq : dir).push(i);
    if (!esq.length || !dir.length) continue;

    return {
      folha: false,
      atributo,
      corte,
      esq: construir(esq, X, profundidade + 1, limite, rand),
      dir: construir(dir, X, profundidade + 1, limite, rand),
    };
  }
  return { folha: true, tamanho: indices.length };
}

function caminho(no, x, profundidade) {
  if (no.folha) return profundidade + c(no.tamanho);
  return caminho(x[no.atributo] < no.corte ? no.esq : no.dir, x, profundidade + 1);
}

/**
 * Treina a floresta e devolve o score de anomalia de cada linha de X.
 * Score em (0,1): perto de 1 é atípico, perto de 0,5 é indistinto do resto.
 *
 * @param {number[][]} X matriz linhas × atributos, já padronizada pelo chamador
 * @param {{arvores:number, amostra:number, semente:number}} opcoes
 */
export function isolationForest(X, { arvores = 100, amostra = 256, semente = 42 } = {}) {
  const n = X.length;
  if (!n) return [];
  const psi = Math.min(amostra, n);
  const limite = Math.ceil(Math.log2(Math.max(psi, 2)));
  const rand = mulberry32(semente);
  const floresta = [];

  for (let t = 0; t < arvores; t += 1) {
    // amostragem sem reposição (Fisher-Yates parcial)
    const idx = [];
    for (let i = 0; i < n; i += 1) idx.push(i);
    for (let i = 0; i < psi; i += 1) {
      const j = i + Math.floor(rand() * (n - i));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    floresta.push(construir(idx.slice(0, psi), X, 0, limite, rand));
  }

  const normal = c(psi);
  return X.map((x) => {
    let soma = 0;
    for (const arvore of floresta) soma += caminho(arvore, x, 0);
    const media = soma / floresta.length;
    return normal > 0 ? 2 ** (-media / normal) : 0.5;
  });
}

/** Padroniza colunas por mediana e MAD — resiste às caudas longas do dado de abate. */
export function padronizar(X) {
  if (!X.length) return X;
  const nAtributos = X[0].length;
  const medianas = [];
  const escalas = [];
  for (let j = 0; j < nAtributos; j += 1) {
    const col = X.map((linha) => linha[j]).filter(Number.isFinite).sort((a, b) => a - b);
    const med = col.length % 2
      ? col[(col.length - 1) / 2]
      : (col[col.length / 2 - 1] + col[col.length / 2]) / 2;
    const desvios = col.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    const mad = desvios.length % 2
      ? desvios[(desvios.length - 1) / 2]
      : (desvios[desvios.length / 2 - 1] + desvios[desvios.length / 2]) / 2;
    medianas.push(med);
    escalas.push(mad > 0 ? mad * 1.4826 : 1);
  }
  return X.map((linha) => linha.map((v, j) =>
    (Number.isFinite(v) ? (v - medianas[j]) / escalas[j] : 0)));
}
