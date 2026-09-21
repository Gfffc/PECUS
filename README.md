# Pecus — Painel de risco sanitário na procedência

Protótipo do PJI410 (Projeto Integrador em Computação IV — Univesp).
A marca do projeto é o **Pecus**; a fonte dos dados é o SIF/SIGSIF (MAPA).

A pergunta que o painel responde é a do pecuarista na hora da negociação:
**o município de onde vem este lote tem histórico sanitário pior que o resto do país?**

---

## Como rodar

Os módulos ES6 não carregam por `file://`: o navegador recusa `import` entre
arquivos sem origem HTTP. Daí o servidor, mesmo sendo tudo estático.

```bash
./servir.sh            # sobe em http://localhost:5500 e devolve o terminal
./servir.sh estado     # diz se está de pé
./servir.sh parar
./servir.sh log        # acompanha o log de acesso
```

O `setsid` solta o servidor do terminal, então fechar o terminal não o derruba.
Para trocar a porta ou expor na rede local:

```bash
PORTA=8080 ./servir.sh
ENDERECO=0.0.0.0 ./servir.sh   # padrão é 127.0.0.1, só esta máquina
```

Para subir junto com a sessão gráfica, um atalho em `~/.config/autostart`:

```bash
cat > ~/.config/autostart/pecus.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Painel Pecus
Exec=$(pwd)/servir.sh
X-GNOME-Autostart-enabled=true
EOF
```

Para regenerar a base a partir das fontes públicas (baixa ~250 MB e agrega):

```bash
python3 data/preparar_dados.py
```

Teste de fumaça sobre a base preparada:

```bash
deno run --allow-read teste_modelo.mjs   # ou: node teste_modelo.mjs
```

---

## Estrutura

```
index.html                      página única
css/estilo.css                  tema visual, claro e escuro
js/config.js                    fontes, níveis, parâmetros do modelo
js/dataService.js               fetch + detecção de encoding + PapaParse
js/transform.js                 normalização, filtros, agregações e taxas
js/anomalia.js                  atributos do modelo + linha de base (z robusto)
js/ml/isolationForest.js        Isolation Forest em JS puro
js/mapa.js                      mapa coroplético em SVG, sem biblioteca
js/charts.js                    Chart.js — lê a paleta das variáveis CSS
js/ui.js                        DOM
js/main.js                      orquestração, tema, gaveta e estado na URL
data/preparar_dados.py          baixa e agrega MAPA + IBGE
data/*.csv, *.geojson           base pronta para o navegador
assets/marca/                   identidade visual: logos, ícone e guia de marca
```

Sem CSS de terceiros: os controles são estilizados no próprio `estilo.css`,
e o mapa é SVG gerado à mão. Só PapaParse e Chart.js vêm de CDN.

A identidade visual — logos, ícone, paleta e regras de uso — está em
[`assets/marca/README.md`](assets/marca/README.md).

---

## Os dados são reais

`data/preparar_dados.py` baixa e agrega, sem intermediário:

| fonte | recurso | o que traz |
|---|---|---|
| MAPA / PGA-SIGSIF | Relatório de Doenças por Procedência | UF × mês × espécie × diagnóstico |
| MAPA / PGA-SIGSIF | Relatório de Abates | UF × mês × categoria |
| MAPA / PGA-SIGSIF | Quantitativo de Doenças por Procedência | município × mês × diagnóstico (4,9 milhões de linhas) |
| IBGE | SIDRA 3939 (Pesquisa Pecuária Municipal) | efetivo bovino por município |
| IBGE | Malhas territoriais v3 | contorno das UFs e dos municípios |

A malha municipal não é baixada de antemão: a API de malhas do IBGE devolve
`Access-Control-Allow-Origin: *`, então o navegador busca o contorno do estado
só quando o usuário entra nele.

**Período:** 2021 em diante. Fevereiro de 2021 é a quebra metodológica entre o
sistema legado e o PGA-SIGSIF, e o degrau é visível no dado bruto — 171 mil
linhas em 2019 contra 486 mil em 2021. Cortar antes da quebra dá uma série
homogênea em vez de uma tendência que é artefato de sistema.

---

## Dois níveis, dois denominadores

Esta é a descoberta que moldou o projeto: **o SIF não publica abate por
município.** O arquivo que tem município não tem espécie nem denominador, e o
de abates para na UF. A métrica original — casos por cabeça abatida no
município — é impossível de calcular com o dado real.

A saída foi separar os níveis e dizer na tela qual está em uso:

| nível | denominador | fonte | filtro de espécie |
|---|---|---|---|
| **UF** | cabeças **abatidas** sob inspeção federal | SIF | sim |
| **município** | cabeças do **rebanho** bovino | IBGE / PPM | não (o dado não tem) |

O filtro de espécie só oferece espécie que tenha abate publicado, senão seria um
filtro que zera a tela: o SIF registra doença de bubalino (578 linhas, 4.028
casos), mas o abate bubalino do período inteiro são 29 mil cabeças no país, e
nenhuma UF chega ao mínimo da comparação. Em "Todas" os bubalinos continuam
contados nos dois lados da divisão.

Os dois números não se comparam entre si, só dentro do mesmo nível. O painel
troca o rótulo, a unidade e a régua de comparação conforme o filtro.

### Como o recorte bovino é feito no arquivo municipal

O arquivo com município não traz espécie, e a maior parte do volume do SIF é de
aves. O share bovino de cada diagnóstico é medido **no arquivo de UF**, que tem
espécie, e só os diagnósticos com pelo menos 70% de casos bovinos entram no
recorte municipal. O heurístico separa bem: fica com cisticercose, fasciolose,
hidatidose, tuberculose e actinomicose; descarta aerossaculite, celulite e
salmonelose das aves.

### O que fica de fora, e por quê

Dois grupos de achados são excluídos dos dois níveis:

1. **Administrativos e fisiológicos** — Material Especificado de Risco
   (remoção preventiva obrigatória contra BSE, sozinha 15 milhões de registros),
   coleta de programa oficial, gestação detectada no post mortem.
2. **Falhas da linha de abate** — contaminação gastrointestinal e biliar,
   escaldagem, evisceração retardada, aspecto repugnante.

O segundo grupo é o que mais muda o resultado, e a razão é conceitual:
contaminação na evisceração é propriedade do **frigorífico**, não do município
de onde o animal veio. Mantê-la faria o painel responder "esta planta trabalha
sujo?" em vez de "esta procedência tem histórico sanitário pior?". Sem a
exclusão, o topo da lista é contaminação e alteração restrita; com ela, é
hidatidose, fasciolose e abscesso — que é o que a pergunta pede.

### Casamento com o IBGE

Os nomes de município do MAPA são comparados com os do IBGE sem acento e sem
caixa, com uma tabela de apelidos para os renomeados (Vila Alta → Alto Paraíso,
Poxoreo → Poxoréu, Fortaleza do Tabocão → Tabocão). Sobram 0,11% dos casos sem
par — o número é impresso ao fim do processamento, para não virar perda silenciosa.

---

## Decisões que sustentam o painel

**1. Nada é exibido como contagem bruta.** Casos sem denominador desenham o mapa
da produção (MT, GO, MS), não o mapa do risco. Toda métrica comparável é uma
taxa por 10 mil cabeças.

**2. Procedência ≠ frigorífico.** O painel usa a UF e o município de origem do
animal. Um lote abatido em Barretos pode ter vindo de Vila Rica.

**3. Detecção não é prevalência.** A taxa mede o que a inspeção federal
registrou. Estado com fiscalização mais rigorosa ou com planta exportadora tende
a registrar mais. Está escrito na própria página.

**4. O modelo é treinado no Brasil inteiro e só depois recortado.** Treinar
dentro de um único estado faria o pior município do estado parecer normal por
falta de comparação.

**5. UF com abate residual fica fora da comparação.** Estados com menos de 20
mil cabeças abatidas no período produzem taxa absurda sobre denominador de três
dígitos. São omitidos do ranking e do mapa, não zerados — e o veredito também
se recusa a publicar a taxa, dizendo que o abate é pequeno demais em vez de
mostrar o número. O Amapá é o caso extremo: 12 casos sobre 475 cabeças no
período inteiro davam 252,6 por 10 mil, um número que um único lote move.

**6. Sem denominador não há veredito.** A tela distingue três impedimentos em
vez de chamar todos de "sem registro": *sem registro* (nenhum caso — e isso não
é o mesmo que rebanho sadio, pode ser gado que não passou por inspeção
federal), *sem denominador* (há caso, falta abate publicado) e *abate residual*
(o denominador não sustenta uma taxa). Nos três a régua de posição some, porque
um marcador parado no meio dela se lê como "dentro do padrão".

---

## O modelo de aprendizagem de máquina

**Isolation Forest** (Liu, Ting & Zhou, 2008), não supervisionado, implementado
em `js/ml/isolationForest.js` sem biblioteca externa.

Não existe rótulo de "procedência arriscada" no dado do MAPA, então não há como
treinar de forma supervisionada. O Isolation Forest isola o ponto raro pelo
número de cortes aleatórios necessários para separá-lo do resto.

Unidade de análise: **município × ano** (cerca de 14,5 mil unidades elegíveis).
Cinco atributos, padronizados por mediana e MAD:

1. taxa por 10 mil do rebanho (log)
2. tamanho do rebanho (log) — porte da procedência
3. razão contra a mediana do próprio estado
4. razão contra a própria história do município
5. participação do diagnóstico dominante — separa surto de uma doença só de um
   quadro difuso

São marcadas as 6% com maior score, desde que a taxa esteja acima da mediana:
sem essa segunda condição o modelo também marcaria a procedência atipicamente
*limpa*, que é informação interessante mas não é risco de compra. Municípios com
rebanho abaixo de 5.000 cabeças ficam fora, porque a taxa fica instável demais.

**Linha de base obrigatória.** O painel roda em paralelo a regra simples de
desvio (z robusto por mediana e MAD) e mostra a concordância entre as duas na
própria tela. Na base atual a concordância fica em torno de 21%: o z marca
municípios com taxa alta em termos absolutos, enquanto o Isolation Forest também
pega procedências de taxa moderada mas concentrada num diagnóstico só, ou fora
do padrão do próprio estado.

Semente fixa em `config.js`: o mesmo recorte devolve sempre o mesmo alerta, e o
teste de fumaça verifica isso.

---

## A interface

O painel responde a uma pergunta feita em pé, no curral, muitas vezes no
celular. Daí as escolhas:

- **O veredito vem antes do gráfico.** A primeira coisa na tela é a frase, a
  taxa e a posição na régua nacional. O resto é justificativa.
- **A régua mostra posição, não só valor.** Saber que a taxa é 13,8 não diz
  nada; saber que ela fica acima de 83% das procedências comparáveis diz.
- **O mapa é o índice, não a ilustração.** Clicar num estado entra nos
  municípios dele; clicar num município fecha o recorte. O ranking ao lado faz o
  mesmo pelo teclado, para quem não quer mirar em polígono.
- **Filtro ativo é visível.** O campo alterado muda de cor e vira uma ficha
  removível, para ninguém ler um número achando que é do Brasil inteiro.
- **O recorte cabe num link.** Os filtros vão para o endereço da página, então a
  consulta pode ser mandada para o veterinário por mensagem.
- **Tema claro e escuro**, seguindo o sistema e com chave manual que persiste.
  Gráficos e mapa leem a paleta das variáveis CSS, então trocar de tema não
  recalcula o modelo.
- **Celular**: os filtros viram gaveta lateral; nada provoca rolagem horizontal.
- **Acessibilidade**: navegação por teclado no mapa e no ranking, `aria-live` no
  veredito, `aria-sort` nas colunas ordenáveis, foco visível, e
  `prefers-reduced-motion` respeitado.

---

## Limites conhecidos deste protótipo

- **O denominador municipal é rebanho, não abate.** Um município que cria e não
  abate localmente aparece com taxa baixa; um que manda todo o rebanho para
  abate federal aparece com taxa alta. É a melhor aproximação disponível, não a
  medida certa.
- **Tocantins destoa** em quase todo diagnóstico (1.738 casos por 10 mil
  abatidas, contra 604 do RS). Antes de tratar como achado epidemiológico, vale
  conferir se não é artefato de registro de uma planta específica.
- O modelo roda no navegador. Com mais espécies ou a série completa, a unidade
  município × ano passa de 100 mil linhas — aí o treino migra para Python
  (scikit-learn) e o painel passa a consumir o score já calculado.
- A PPM do IBGE sai com defasagem: os anos de SIF sem PPM correspondente herdam
  o último efetivo disponível.
- Sem exportação de relatório diagramado. A tabela de alertas sai em CSV e a
  página inteira imprime em PDF pelo navegador.

---

## Próximos passos sugeridos

1. Validar o painel com o pecuarista entrevistado: o veredito responde à
   pergunta dele na hora da negociação?
2. Investigar o caso de Tocantins antes de usá-lo como evidência.
3. Cruzar com o efetivo abatido estimado por município (GTA estadual), se
   alguma UF publicar, para trocar o denominador de rebanho por abate.
4. Comparar o Isolation Forest com regressão binomial negativa com harmônicas de
   Fourier, que trata sazonalidade explicitamente.
5. Levar o treino para Python e persistir os scores, mantendo o front-end leve.
