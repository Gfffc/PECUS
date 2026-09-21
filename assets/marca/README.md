# Pecus — identidade visual

Marca do painel do PJI410. O guia completo, com as aplicações em página,
está em [`pecus-identidade-visual.pdf`](pecus-identidade-visual.pdf).

## Arquivos

| Arquivo | Uso |
| --- | --- |
| `pecus-logo.svg` | Logo horizontal, fundo claro. Cabeçalho de relatório, capa, slides. |
| `pecus-logo-mono.svg` | Versão monocromática clara, para fundo escuro. |
| `pecus-icon.svg` | Só o ícone, quadrado. Favicon e ícone de app. |
| `pecus-identidade-visual.pdf` | Guia de marca: aplicações e paleta. |

## Paleta

| Nome | Hex | Token CSS |
| --- | --- | --- |
| Verde sanidade | `#2F7D5B` | `--marca-verde` |
| Verde escuro | `#1F4F3A` | `--marca-verde-escuro` |
| Âmbar alerta | `#E8A13A` | `--marca-ambar` |
| Creme | `#F4F1E8` | `--marca-creme` |

Os tokens ficam em `css/estilo.css`, no bloco 1 (TOKENS). São a paleta **da
marca** e são invariantes entre os temas: a paleta **do painel** (verdes, ocres
e ferrugem, que mudam com o tema claro/escuro) continua sendo a usada nos
gráficos, no mapa e nos níveis de risco. Não misture as duas.

## O símbolo no painel

A cabeça do Pecus também existe como símbolo SVG dentro do `index.html`, no
bloco ÍCONES, com o id `i-pecus` — é ela que aparece no chip do cabeçalho e na
tela de carregamento:

```html
<span class="barra__logo"><svg viewBox="0 0 24 24"><use href="#i-pecus"/></svg></span>
```

A geometria é a mesma do `pecus-icon.svg`, reescalada para a caixa de 24×24 que
os outros ícones usam. Ela herda a cor do contêiner por `currentColor` (a
cabeça), e as áreas vazadas — olho esquerdo e focinho — seguem a variável
`--marca-vazado`, que deve receber a cor de fundo do contêiner. O olho direito é
sempre âmbar. Ao usar o símbolo em um fundo novo:

```css
.meu-chip { background: var(--marca-verde); color: var(--marca-creme);
            --marca-vazado: var(--marca-verde); }
```

## Aplicações no protótipo

- **Favicon e ícone de app** — `pecus-icon.svg`, no `<head>`.
- **Cabeçalho** — chip com `#i-pecus` + a assinatura "Pecus · risco sanitário na origem".
- **Tela de carregamento** — o mesmo chip, maior.
- **Rodapé** — o logo horizontal; a versão mono entra sozinha no tema escuro, e
  a impressão força a versão clara.
