/* =========================================================
   anomalia.js — o "padrão atípico de incidência" do Plano de Ação.

   Convenção do projeto respeitada aqui: todo modelo é comparado com uma
   linha de base ingênua. A base é o z robusto (mediana e MAD) sobre a
   taxa por 10 mil. Se o Isolation Forest não acrescentar nada além do
   que o z já apontava, ele não está pagando o próprio custo — e o painel
   mostra essa concordância em vez de escondê-la.
   ========================================================= */

import { MODELO } from './config.js';
import { isolationForest, padronizar } from './ml/isolationForest.js';
import { mediana, zRobusto } from './transform.js';

/**
 * Cinco atributos, cada um respondendo a uma pergunta que o pecuarista faria:
 *  1. a taxa é alta?                        log da taxa por 10 mil
 *  2. o município tem escala?               log do rebanho bovino (IBGE)
 *  3. é alta para o estado dela?            razão contra a mediana da UF
 *  4. é alta para a própria história?       razão contra as outras safras do município
 *  5. é uma doença só ou é difuso?          participação do diagnóstico dominante
 */
function montarAtributos(unidades) {
  const porUF = new Map();
  const porMunicipio = new Map();
  for (const u of unidades) {
    if (!porUF.has(u.uf)) porUF.set(u.uf, []);
    porUF.get(u.uf).push(u.taxa);
    const km = `${u.uf}|${u.municipio}`;
    if (!porMunicipio.has(km)) porMunicipio.set(km, []);
    porMunicipio.get(km).push(u.taxa);
  }
  const medUF = new Map([...porUF].map(([k, v]) => [k, mediana(v)]));
  const medMun = new Map([...porMunicipio].map(([k, v]) => [k, mediana(v)]));

  return unidades.map((u) => {
    const refUF = medUF.get(u.uf) || 1e-6;
    const refMun = medMun.get(`${u.uf}|${u.municipio}`) || 1e-6;
    return [
      Math.log10(u.taxa + 1),
      Math.log10(u.rebanho + 1),
      Math.log10((u.taxa + 1e-6) / refUF + 1),
      Math.log10((u.taxa + 1e-6) / refMun + 1),
      u.shareDominante,
    ];
  });
}

function quantil(valores, q) {
  const v = valores.slice().sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const base = Math.floor(pos);
  const resto = pos - base;
  return v[base + 1] !== undefined ? v[base] + resto * (v[base + 1] - v[base]) : v[base];
}

/**
 * Roda o modelo sobre as unidades elegíveis e devolve cada unidade
 * anotada com score, z da linha de base e o veredito do detector.
 */
export function detectar(unidades) {
  const elegiveis = unidades.filter((u) => u.rebanho >= MODELO.minRebanhoAno);
  const ignoradas = unidades.length - elegiveis.length;

  if (elegiveis.length < 20) {
    return {
      unidades: elegiveis.map((u) => ({ ...u, score: NaN, z: NaN, alerta: false })),
      alertas: [],
      diagnostico: {
        treinadas: elegiveis.length,
        ignoradas,
        suficiente: false,
        limiar: NaN,
        concordancia: NaN,
      },
    };
  }

  const X = padronizar(montarAtributos(elegiveis));
  const scores = isolationForest(X, {
    arvores: MODELO.arvores,
    amostra: MODELO.amostraPorArvore,
    semente: MODELO.semente,
  });
  const z = zRobusto(elegiveis.map((u) => u.taxa));
  const limiar = quantil(scores, 1 - MODELO.fracaoAlerta);

  const anotadas = elegiveis.map((u, i) => ({
    ...u,
    score: scores[i],
    z: z[i],
    // o alerta exige score alto E taxa acima da mediana: sem a segunda
    // condição o modelo marcaria também a procedência atipicamente limpa,
    // que é informação útil mas não é risco de compra
    alerta: scores[i] >= limiar && z[i] > 0,
  }));

  const marcadasModelo = new Set(anotadas.filter((u) => u.alerta).map((u) => u.id));
  const marcadasBase = new Set(anotadas.filter((u) => u.z >= 3).map((u) => u.id));
  const uniao = new Set([...marcadasModelo, ...marcadasBase]);
  const intersecao = [...marcadasModelo].filter((id) => marcadasBase.has(id));

  return {
    unidades: anotadas,
    alertas: anotadas.filter((u) => u.alerta).sort((a, b) => b.score - a.score),
    diagnostico: {
      treinadas: elegiveis.length,
      ignoradas,
      suficiente: true,
      limiar,
      naBase: marcadasBase.size,
      noModelo: marcadasModelo.size,
      concordancia: uniao.size ? intersecao.length / uniao.size : NaN,
    },
  };
}
