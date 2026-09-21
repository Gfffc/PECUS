/* =========================================================
   config.js — tudo que muda quando a base do MAPA é
   reprocessada fica aqui dentro.

   Os arquivos em data/ são gerados por data/preparar_dados.py
   a partir dos recursos públicos do PGA-SIGSIF e do IBGE.
   ========================================================= */

export const FONTES = {
  ufDoencas: 'data/sif_uf_doencas.csv',
  ufAbates: 'data/sif_uf_abates.csv',
  munDoencas: 'data/sif_municipio_doencas.csv',
  malhaUF: 'data/ibge_malha_uf.geojson',
};

/* Malha municipal sob demanda: a API de malhas do IBGE devolve
   Access-Control-Allow-Origin: *, então o navegador busca direto. */
export const MALHA_MUNICIPAL = (codigoUF) =>
  `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${codigoUF}`
  + '?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio';

/* Códigos do IBGE: a malha identifica cada feição por "codarea". */
export const UF_POR_CODIGO = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL',
  28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};
export const CODIGO_POR_UF = Object.fromEntries(
  Object.entries(UF_POR_CODIGO).map(([c, u]) => [u, Number(c)]));

export const NOME_UF = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco',
  PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina',
  SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

/* Os dois níveis medem coisas diferentes e a interface precisa dizer qual.
   O SIF não publica abate por município: o arquivo que tem município não tem
   espécie nem denominador. No município o denominador é o rebanho do IBGE. */
export const NIVEIS = {
  uf: {
    chave: 'uf',
    unidade: 'casos por 10 mil cabeças abatidas',
    curta: 'por 10 mil abatidas',
    denominador: 'cabeças abatidas sob inspeção federal',
    fonte: 'SIF — Relatório de Doenças por Procedência e Relatório de Abates',
  },
  municipio: {
    chave: 'municipio',
    unidade: 'casos por 10 mil cabeças do rebanho',
    curta: 'por 10 mil do rebanho',
    denominador: 'efetivo bovino municipal (IBGE/PPM)',
    fonte: 'SIF — Quantitativo de Doenças por Procedência · IBGE — PPM 3939',
  },
};

/* Regras do modelo de detecção de padrões atípicos. */
export const MODELO = {
  arvores: 120,
  amostraPorArvore: 256,
  // fração das unidades (município × ano) marcada como atípica
  fracaoAlerta: 0.06,
  // abaixo deste rebanho a taxa é instável demais para virar alerta
  minRebanhoAno: 5000,
  semente: 20260914,
};

/* Volume mínimo para uma UF entrar na comparação: estados com abate
   federal residual produzem taxa absurda sobre denominador de três dígitos. */
export const MIN_ABATIDOS_UF = 20000;

/* Faixas de classificação do veredito, em múltiplos da mediana nacional. */
export const FAIXAS = [
  { ate: 0.75, chave: 'baixo', rotulo: 'Abaixo da mediana nacional' },
  { ate: 1.30, chave: 'tipico', rotulo: 'Dentro do padrão nacional' },
  { ate: 2.00, chave: 'atencao', rotulo: 'Acima da mediana nacional' },
  { ate: Infinity, chave: 'alto', rotulo: 'Muito acima da mediana nacional' },
];

/* A paleta dos gráficos e do mapa mora em css/estilo.css (variáveis --g-*),
   e não aqui, para que a troca de tema claro/escuro não exija recalcular
   nada: charts.js e mapa.js leem as variáveis no momento de desenhar. */

const nf = new Intl.NumberFormat('pt-BR');
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export const fmt = {
  inteiro: (v) => (Number.isFinite(v) ? nf.format(Math.round(v)) : '—'),
  compacto: (v) => (Number.isFinite(v) ? compacto.format(v) : '—'),
  taxa: (v) => (Number.isFinite(v) ? nf1.format(v) : '—'),
  razao: (v) => (Number.isFinite(v) ? nf2.format(v) : '—'),
  pct: (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—'),
  mes: (m) => ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
    'jul', 'ago', 'set', 'out', 'nov', 'dez'][m - 1] ?? '—',
};
