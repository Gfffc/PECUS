/* =========================================================
   transform.js — dos CSVs preparados às métricas do painel.

   Decisão central do projeto: nada aqui devolve contagem bruta como
   indicador comparável. Contagem de casos sem denominador desenha o mapa
   da produção (MT, GO, MS), não o mapa do risco sanitário.

   Os dois níveis têm denominadores diferentes porque o dado obriga:

     UF         casos ÷ cabeças ABATIDAS sob inspeção federal
     município  casos ÷ REBANHO bovino do IBGE

   O SIF não publica abate por município. Quem exibe o número tem que
   dizer qual dos dois está mostrando — ver NIVEIS em config.js.
   ========================================================= */

const UFS_VALIDAS = new Set(['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC',
  'SE', 'SP', 'TO']);

/* Separador das chaves compostas. Nome de município não contém barra vertical. */
const SEP = '|';

function numero(valor) {
  if (typeof valor === 'number') return valor;
  const s = String(valor ?? '').trim();
  if (!s) return NaN;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : NaN;
}

/* ---------- normalização ---------- */

export function normalizarUfDoencas({ linhas }) {
  const registros = [];
  let descartadas = 0;
  for (const l of linhas) {
    const ano = numero(l.ano);
    const mes = numero(l.mes);
    const casos = numero(l.casos);
    const uf = String(l.uf ?? '').trim().toUpperCase();
    if (!Number.isFinite(ano) || !Number.isFinite(casos) || casos <= 0 || !UFS_VALIDAS.has(uf)) {
      descartadas += 1;
      continue;
    }
    const m = Number.isFinite(mes) && mes >= 1 && mes <= 12 ? mes : 1;
    registros.push({
      ano,
      mes: m,
      periodo: ano * 100 + m,
      uf,
      especie: String(l.especie ?? '').trim(),
      diagnostico: String(l.diagnostico ?? '').trim(),
      casos,
    });
  }
  return { registros, descartadas };
}

export function normalizarUfAbates({ linhas }) {
  const registros = [];
  for (const l of linhas) {
    const ano = numero(l.ano);
    const mes = numero(l.mes);
    const abatidos = numero(l.abatidos);
    const uf = String(l.uf ?? '').trim().toUpperCase();
    if (!Number.isFinite(ano) || !Number.isFinite(abatidos) || abatidos <= 0
      || !UFS_VALIDAS.has(uf)) continue;
    const m = Number.isFinite(mes) && mes >= 1 && mes <= 12 ? mes : 1;
    registros.push({
      ano,
      mes: m,
      periodo: ano * 100 + m,
      uf,
      especie: String(l.especie ?? '').trim(),
      abatidos,
    });
  }
  return { registros };
}

export function normalizarMunicipios({ linhas }) {
  const registros = [];
  let descartadas = 0;
  for (const l of linhas) {
    const ano = numero(l.ano);
    const casos = numero(l.casos);
    const rebanho = numero(l.rebanho);
    const uf = String(l.uf ?? '').trim().toUpperCase();
    const municipio = String(l.municipio ?? '').trim();
    if (!Number.isFinite(ano) || !Number.isFinite(casos) || casos <= 0
      || !UFS_VALIDAS.has(uf) || !municipio) {
      descartadas += 1;
      continue;
    }
    registros.push({
      ano,
      uf,
      municipio,
      codigo: String(l.codigo_ibge ?? '').trim(),
      diagnostico: String(l.diagnostico ?? '').trim(),
      casos,
      rebanho: Number.isFinite(rebanho) ? rebanho : 0,
    });
  }
  return { registros, descartadas };
}

/* ---------- filtros ---------- */

const casa = (valor, escolhido) => escolhido === 'todos' || valor === escolhido;

export function filtrarUfDoencas(registros, f) {
  return registros.filter((r) => casa(r.uf, f.uf)
    && casa(r.especie, f.especie)
    && casa(r.diagnostico, f.diagnostico)
    && r.ano >= f.anoIni && r.ano <= f.anoFim);
}

/** O denominador nunca é filtrado por diagnóstico: o rebanho abatido é o mesmo. */
export function filtrarUfAbates(registros, f) {
  return registros.filter((r) => casa(r.uf, f.uf)
    && casa(r.especie, f.especie)
    && r.ano >= f.anoIni && r.ano <= f.anoFim);
}

export function filtrarMunicipios(registros, f) {
  return registros.filter((r) => casa(r.uf, f.uf)
    && casa(r.municipio, f.municipio)
    && casa(r.diagnostico, f.diagnostico)
    && r.ano >= f.anoIni && r.ano <= f.anoFim);
}

/* ---------- agregações ---------- */

function somarPor(registros, chave, campo) {
  const mapa = new Map();
  for (const r of registros) {
    const k = chave(r);
    mapa.set(k, (mapa.get(k) ?? 0) + r[campo]);
  }
  return mapa;
}

function combinar(casosPor, denomPor, minDenom = 1) {
  const linhas = [];
  for (const [k, denom] of denomPor) {
    if (denom < minDenom) continue;
    const casos = casosPor.get(k) ?? 0;
    linhas.push({ k, casos, denom, taxa: (casos / denom) * 10000 });
  }
  return linhas;
}

/** Comparação entre estados: casos por 10 mil cabeças abatidas. */
export function porUF(doencas, abates, minAbatidos = 0) {
  return combinar(somarPor(doencas, (r) => r.uf, 'casos'),
    somarPor(abates, (r) => r.uf, 'abatidos'), minAbatidos)
    .map((l) => ({ uf: l.k, casos: l.casos, abatidos: l.denom, taxa: l.taxa }))
    .sort((a, b) => b.taxa - a.taxa);
}

export function porMes(doencas, abates) {
  return combinar(somarPor(doencas, (r) => r.periodo, 'casos'),
    somarPor(abates, (r) => r.periodo, 'abatidos'))
    .map((l) => ({
      periodo: l.k,
      ano: Math.floor(l.k / 100),
      mes: l.k % 100,
      casos: l.casos,
      abatidos: l.denom,
      taxa: l.taxa,
    }))
    .sort((a, b) => a.periodo - b.periodo);
}

/** Sazonalidade: taxa média por mês do calendário, todos os anos do recorte. */
export function porMesCalendario(doencas, abates) {
  return combinar(somarPor(doencas, (r) => r.mes, 'casos'),
    somarPor(abates, (r) => r.mes, 'abatidos'))
    .map((l) => ({ mes: l.k, casos: l.casos, abatidos: l.denom, taxa: l.taxa }))
    .sort((a, b) => a.mes - b.mes);
}

export function porDiagnostico(registros, totalDenominador) {
  const casos = somarPor(registros, (r) => r.diagnostico, 'casos');
  return [...casos.entries()]
    .map(([diagnostico, c]) => ({
      diagnostico,
      casos: c,
      taxa: totalDenominador > 0 ? (c / totalDenominador) * 10000 : NaN,
    }))
    .sort((a, b) => b.casos - a.casos);
}

/** Unidade de análise do modelo: município × ano, denominador = rebanho. */
export function porMunicipioAno(registros) {
  const agregado = new Map();
  for (const r of registros) {
    const k = `${r.uf}${SEP}${r.municipio}${SEP}${r.ano}`;
    let u = agregado.get(k);
    if (!u) {
      u = {
        id: k,
        uf: r.uf,
        municipio: r.municipio,
        codigo: r.codigo,
        ano: r.ano,
        casos: 0,
        rebanho: r.rebanho,
        porDiag: new Map(),
      };
      agregado.set(k, u);
    }
    u.casos += r.casos;
    // o rebanho vem repetido em toda linha do mesmo município e ano
    if (r.rebanho > u.rebanho) u.rebanho = r.rebanho;
    u.porDiag.set(r.diagnostico, (u.porDiag.get(r.diagnostico) ?? 0) + r.casos);
  }

  const fora = [];
  for (const u of agregado.values()) {
    if (!(u.rebanho > 0)) continue;
    const diags = [...u.porDiag.entries()].sort((a, b) => b[1] - a[1]);
    const dominante = diags[0];
    fora.push({
      id: u.id,
      uf: u.uf,
      municipio: u.municipio,
      codigo: u.codigo,
      ano: u.ano,
      casos: u.casos,
      rebanho: u.rebanho,
      taxa: (u.casos / u.rebanho) * 10000,
      diagDominante: dominante ? dominante[0] : '—',
      shareDominante: dominante && u.casos > 0 ? dominante[1] / u.casos : 0,
    });
  }
  return fora;
}

/** Agrega município × ano por município, somando o período do recorte. */
export function porMunicipio(unidades) {
  const mapa = new Map();
  for (const u of unidades) {
    const k = `${u.uf}${SEP}${u.municipio}`;
    let m = mapa.get(k);
    if (!m) {
      m = {
        uf: u.uf,
        municipio: u.municipio,
        codigo: u.codigo,
        casos: 0,
        rebanho: 0,
        anos: 0,
        alertas: 0,
      };
      mapa.set(k, m);
    }
    m.casos += u.casos;
    // rebanho-ano: o denominador acompanha a extensão do período escolhido
    m.rebanho += u.rebanho;
    m.anos += 1;
    if (u.alerta) m.alertas += 1;
  }
  return [...mapa.values()]
    .map((m) => ({ ...m, taxa: m.rebanho > 0 ? (m.casos / m.rebanho) * 10000 : NaN }))
    .sort((a, b) => b.taxa - a.taxa);
}

/* ---------- estatística de apoio ---------- */

export function mediana(valores) {
  const v = valores.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** z robusto (mediana e MAD): a linha de base contra a qual o modelo é comparado. */
export function zRobusto(valores) {
  const med = mediana(valores);
  const mad = mediana(valores.map((v) => Math.abs(v - med)));
  const escala = mad > 0 ? mad * 1.4826 : NaN;
  return valores.map((v) => (Number.isFinite(escala) ? (v - med) / escala : 0));
}

export function distintos(registros, campo) {
  return [...new Set(registros.map((r) => r[campo]))].filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}
