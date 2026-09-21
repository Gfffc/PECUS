/* =========================================================
   charts.js — só desenho. Recebe dado pronto, devolve pixel.

   As cores saem das variáveis CSS em vez de ficarem fixas aqui:
   assim o gráfico acompanha a troca de tema claro/escuro sem que
   o painel precise recalcular o modelo.
   ========================================================= */

import { fmt } from './config.js';

const semAnimacao = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.animation = semAnimacao ? false : { duration: 400, easing: 'easeOutQuart' };
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.responsive = true;

/** Lê a paleta corrente do documento. Chamada a cada desenho. */
function paleta() {
  const s = getComputedStyle(document.documentElement);
  const v = (nome, reserva) => (s.getPropertyValue(nome).trim() || reserva);
  return {
    baixo: v('--g-baixo', '#2F6B44'),
    tipico: v('--g-tipico', '#5C9E74'),
    atencao: v('--g-atencao', '#C8901F'),
    alto: v('--g-alto', '#9E3B24'),
    neutro: v('--g-neutro', '#8A9187'),
    grade: v('--g-grade', '#E2E6DB'),
    eixo: v('--g-eixo', '#79806F'),
    tinta: v('--g-tinta', '#102A1A'),
    superficie: v('--superficie', '#FFFFFF'),
    borda: v('--borda', '#DFE4D8'),
    texto: v('--tinta', '#1C231B'),
    textoFraco: v('--tinta-fraca', '#79806F'),
  };
}

/** Transparência sobre uma cor hex de 6 dígitos. */
function comAlfa(hex, alfa) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

const graficos = {};
const fabricas = {};

/** Guarda a fábrica de configuração para poder repintar na troca de tema. */
function trocar(id, fabrica) {
  fabricas[id] = fabrica;
  const ctx = document.getElementById(id);
  if (!ctx) return;
  graficos[id]?.destroy();
  graficos[id] = new Chart(ctx, fabrica(paleta()));
}

export function repintar() {
  for (const [id, fabrica] of Object.entries(fabricas)) {
    const ctx = document.getElementById(id);
    if (!ctx) continue;
    graficos[id]?.destroy();
    graficos[id] = new Chart(ctx, fabrica(paleta()));
  }
}

function dica(p) {
  return {
    backgroundColor: p.superficie,
    titleColor: p.texto,
    bodyColor: p.textoFraco,
    borderColor: p.borda,
    borderWidth: 1,
    cornerRadius: 8,
    padding: 10,
    titleFont: { weight: '700', size: 12.5 },
    bodyFont: { size: 12 },
    boxPadding: 4,
    displayColors: false,
  };
}

const eixoY = (p) => ({
  grid: { color: p.grade, drawTicks: false },
  border: { display: false },
  ticks: { padding: 8, color: p.eixo },
});
const eixoX = (p) => ({
  grid: { display: false },
  border: { color: p.grade },
  ticks: { color: p.eixo },
});

export function graficoSerie(linhas) {
  trocar('grafico-serie', (p) => ({
    type: 'line',
    data: {
      labels: linhas.map((l) => `${fmt.mes(l.mes)}/${String(l.ano).slice(2)}`),
      datasets: [{
        label: 'Casos por 10 mil cabeças',
        data: linhas.map((l) => l.taxa),
        borderColor: p.baixo,
        backgroundColor: (ctx) => {
          const { chartArea, ctx: c } = ctx.chart;
          if (!chartArea) return comAlfa(p.baixo, .12);
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, comAlfa(p.baixo, .28));
          g.addColorStop(1, comAlfa(p.baixo, .01));
          return g;
        },
        borderWidth: 2,
        fill: true,
        pointRadius: linhas.length > 40 ? 0 : 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: p.superficie,
        pointBorderColor: p.baixo,
        pointBorderWidth: 2,
        tension: 0.3,
      }],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...dica(p),
          callbacks: {
            label: (c) => {
              const l = linhas[c.dataIndex];
              return [`${fmt.taxa(l.taxa)} casos por 10 mil`,
                `${fmt.inteiro(l.casos)} casos · ${fmt.compacto(l.abatidos)} cabeças abatidas`];
            },
          },
        },
      },
      scales: {
        y: { ...eixoY(p), beginAtZero: true },
        x: { ...eixoX(p), ticks: { color: p.eixo, maxTicksLimit: 12, autoSkip: true, maxRotation: 0 } },
      },
    },
  }));
}

export function graficoSazonal(linhas) {
  trocar('grafico-sazonal', (p) => {
    const maior = Math.max(...linhas.map((l) => l.taxa), 0);
    return {
      type: 'bar',
      data: {
        labels: linhas.map((l) => fmt.mes(l.mes)),
        datasets: [{
          data: linhas.map((l) => l.taxa),
          // o mês de pico ganha destaque: é a leitura que interessa aqui
          backgroundColor: linhas.map((l) => (l.taxa === maior ? p.atencao : comAlfa(p.tipico, .75))),
          hoverBackgroundColor: linhas.map((l) => (l.taxa === maior ? p.atencao : p.tipico)),
          borderRadius: 4,
          maxBarThickness: 26,
        }],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            ...dica(p),
            callbacks: {
              title: (c) => `${c[0].label} (todos os anos do período)`,
              label: (c) => `${fmt.taxa(c.parsed.y)} casos por 10 mil`,
            },
          },
        },
        scales: { y: { ...eixoY(p), beginAtZero: true }, x: eixoX(p) },
      },
    };
  });
}

export function graficoDispersao(unidades) {
  const normais = unidades.filter((u) => !u.alerta);
  const atipicas = unidades.filter((u) => u.alerta);
  const ponto = (u) => ({ x: u.rebanho, y: u.taxa, u });

  trocar('grafico-dispersao', (p) => ({
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Dentro do padrão',
          data: normais.map(ponto),
          backgroundColor: comAlfa(p.tipico, .45),
          borderColor: comAlfa(p.tipico, .7),
          borderWidth: 1,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
        {
          label: 'Fora do padrão',
          data: atipicas.map(ponto),
          backgroundColor: comAlfa(p.alto, .9),
          borderColor: p.alto,
          borderWidth: 1,
          pointRadius: 6.5,
          pointHoverRadius: 9,
          pointStyle: 'triangle',
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, boxWidth: 8, color: p.textoFraco, padding: 16 },
        },
        tooltip: {
          ...dica(p),
          callbacks: {
            title: (c) => `${c[0].raw.u.municipio}/${c[0].raw.u.uf} — ${c[0].raw.u.ano}`,
            label: (c) => {
              const u = c.raw.u;
              return [`${fmt.taxa(u.taxa)} casos por 10 mil`,
                `${fmt.compacto(u.rebanho)} cabeças no rebanho`,
                `principal: ${u.diagDominante} (${Math.round(u.shareDominante * 100)}%)`];
            },
          },
        },
      },
      scales: {
        x: {
          ...eixoX(p),
          type: 'logarithmic',
          title: { display: true, text: 'rebanho bovino do município (escala log)', color: p.textoFraco },
        },
        y: {
          ...eixoY(p),
          beginAtZero: true,
          title: { display: true, text: 'casos por 10 mil do rebanho', color: p.textoFraco },
        },
      },
    },
  }));
}
