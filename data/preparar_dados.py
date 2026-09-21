#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Baixa e prepara a base real do painel. Substitui gerar_amostra.py.

Fontes
------
MAPA / PGA-SIGSIF (dados.agricultura.gov.br, conjunto 062166e3):
  - Relatório de Doenças por Procedência ...... UF x mês x espécie x diagnóstico
  - Relatório de Abates ...................... UF x mês x categoria (macho/fêmea)
  - Quantitativo de Doenças por Procedência ... município x mês x diagnóstico (238 MB)
IBGE:
  - PPM/SIDRA 3939 ........................... efetivo bovino por município
  - Malhas v3 ................................ contorno das UFs (GeoJSON)

Por que dois níveis de análise
------------------------------
O SIF não publica abate por município: o arquivo que tem município não tem
espécie nem denominador, e o de abates para na UF. Então:

  UF        casos / cabeças ABATIDAS      (método original, com filtro de espécie)
  município casos / REBANHO bovino IBGE   (sem filtro de espécie — o dado não tem)

Os dois números não são intercambiáveis e a interface diz qual está usando.

Por que filtrar diagnóstico por espécie predominante
-----------------------------------------------------
O arquivo municipal não traz espécie, e a maior parte do volume do SIF é de
aves. O share bovino de cada diagnóstico é medido no arquivo de UF (que tem
espécie) e só os predominantemente bovinos entram no recorte municipal.
Achados administrativos (MER, coleta de programa oficial, gestação detectada
no post mortem) são excluídos: não são doença de procedência.
"""
import csv
import gzip
import io
import json
import os
import re
import sys
import unicodedata
import urllib.request
from collections import Counter, defaultdict

AQUI = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(AQUI, '_brutos')
ANO_INI = 2021

UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/140.0 Safari/537.36'}

BASE_MAPA = ('https://dados.agricultura.gov.br/dataset/'
             '062166e3-b515-4274-8e7d-68aadd64b820/resource')
RECURSOS = {
    'doencas_uf.csv': f'{BASE_MAPA}/6b28acd9-2d55-4d0a-a9d1-06cb49952812/'
                      'download/sigsifrelatoriodoencasporprocedencia.csv',
    'abates_uf.csv': f'{BASE_MAPA}/341dc717-4716-42ab-b189-c8d7a9d2a1ba/'
                     'download/sigsifrelatorioabates.csv',
    'doencas_municipio.csv': f'{BASE_MAPA}/c6f5abb0-3b26-4c93-81c3-b3c88755baec/'
                             'download/sigsifquantitativodoencasporprocedencia.csv',
}

# Achados que não são doença de procedência. Dois grupos:
#
#  (a) administrativos e fisiológicos — remoção preventiva obrigatória, coleta
#      de programa oficial, gestação detectada no post mortem;
#  (b) falhas da linha de abate — contaminação, escaldagem, evisceração. Estas
#      são propriedade do FRIGORÍFICO, não do município de onde o animal veio.
#      Mantê-las faria o painel responder "esta planta trabalha sujo?" em vez
#      de "esta procedência tem histórico sanitário pior?", que é a pergunta
#      do projeto. São a maior parte do volume bruto do SIF, então a diferença
#      no resultado é grande — e é justamente por isso que ficam de fora.
NAO_SANITARIOS = {
    'MATERIAL ESPECIFICADO DE RISCO (INUTILIZACAO)',
    'COLETADOS (PROGRAMAS OFICIAIS)',
    'GESTACAO (DETECTADA NO POST MORTEM)',
    'DESCLASSIFICACAO COMERCIAL (NAO SANITARIA)',
    'FALHA TECNOLOGICA', 'FALHAS TECNOLOGICAS',
    'MORTO (NO TRANSPORTE)', 'MORTO (NO CURRAL)', 'MORTO (NO PRE ABATE)',
    'RECOLHIDOS MORTOS (PESCADO)',
    # (b) falhas de processo do abatedouro
    'CONTAMINACAO GASTROINTESTINAL E BILIAR',
    'CONTAMINACAO NAO GASTROINTESTINAL',
    'CONTAMINACAO', 'CONTAMINACAO BILIAR', 'CONTAMINACAO GASTROINTESTINAL',
    'ALTERACAO RESTRITA',
    'ASPECTO REPUGNANTE (POST MORTEM)', 'ASPECTO REPUGNANTE',
    'EVISCERACAO RETARDADA', 'ESCALDAGEM EXCESSIVA', 'ESCALDAGEM',
    'SANGRIA MAL FEITA', 'SANGRIA INCOMPLETA',
    'ESTADO ANORMAL/PATOLOGICO NAO PREVISTO',
}

# Categorias de abate que são bovino/bubalino — o denominador do nível UF.
CAT_BOVINAS = {
    'BOVINO', 'VACA', 'TOURO', 'TOURO/TOURUNO', 'NOVILHO', 'NOVILHA',
    'NOVILHAO', 'NOVILHONA', 'NOVILHO PRECOCE', 'BEZERRO', 'BEZERRA',
    'GARROTE', 'BUFALO', 'BUFALA', 'BUBALINO', 'BOI',
}

# O MAPA guarda o nome vigente na época do registro; o IBGE publica o atual.
ALIAS = {
    ('PR', 'VILAALTA'): 'Alto Paraíso',
    ('MT', 'POXOREO'): 'Poxoréu',
    ('TO', 'COUTODEMAGALHAES'): 'Couto Magalhães',
    ('TO', 'FORTALEZADOTABOCAO'): 'Tabocão',
    ('MG', 'BRASOPOLIS'): 'Brazópolis',
    ('MG', 'ITABIRINHADEMANTENA'): 'Itabirinha',
    ('SP', 'SAOLUISDOPARAITINGA'): 'São Luiz do Paraitinga',
    ('SC', 'PICARRAS'): 'Balneário Piçarras',
    ('BA', 'MUQUEM DE SAO FRANCISCO'): 'Muquém do São Francisco',
    ('RN', 'AUGUSTOSEVERO'): 'Campo Grande',
    ('PB', 'CAMPODEsANTANA'): 'Tacima',
    ('PA', 'SANTAISABELDOPARA'): 'Santa Izabel do Pará',
    ('MS', 'ANGELICA'): 'Angélica',
}

UFS = {'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS',
       'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC',
       'SE', 'SP', 'TO'}


# --------------------------------------------------------------- utilidades

def sem_acento(texto):
    s = unicodedata.normalize('NFD', texto or '')
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn')


def chave(texto):
    """Forma canônica para casar nome do MAPA com nome do IBGE."""
    return re.sub(r'[^A-Z0-9]+', '', sem_acento(texto or '').upper())


def rotulo(texto):
    """Título legível: o MAPA mistura CAIXA ALTA e Title Case na mesma coluna."""
    s = re.sub(r'\s+', ' ', (texto or '').strip())
    if not s:
        return s
    if s.isupper() or s.islower():
        miudas = {'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na'}
        partes = []
        for i, p in enumerate(s.lower().split(' ')):
            partes.append(p if (i and p in miudas) else p[:1].upper() + p[1:])
        s = ' '.join(partes)
    return s


# Um mesmo diagnóstico aparece como "Fasciolose Hepática (notificação Sif)" e
# "Fasciolose Hepática (Notificação Sif)". A chave sem acento e em caixa alta
# junta as variantes; o rótulo exibido é a grafia mais frequente.
CANON = {}


def canonizar(texto):
    return CANON.get(norm_diag(texto), rotulo(texto))


def norm_diag(texto):
    return re.sub(r'\s+', ' ', sem_acento(texto or '').upper()).strip()


def baixar(nome, url):
    destino = os.path.join(CACHE, nome)
    if os.path.exists(destino) and os.path.getsize(destino) > 1024:
        print(f'  · {nome} já em cache ({os.path.getsize(destino)/1e6:.1f} MB)')
        return destino
    os.makedirs(CACHE, exist_ok=True)
    print(f'  ↓ {nome} …', end='', flush=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=600) as r, open(destino, 'wb') as f:
        while True:
            bloco = r.read(1 << 20)
            if not bloco:
                break
            f.write(bloco)
    print(f' {os.path.getsize(destino)/1e6:.1f} MB')
    return destino


def json_web(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=600) as r:
        bruto = r.read()
    if bruto[:2] == b'\x1f\x8b':          # a API de malhas responde em gzip
        bruto = gzip.decompress(bruto)
    return json.loads(bruto.decode('utf-8'))


def linhas(caminho):
    """Os recursos do MAPA vêm em UTF-8 apesar do histórico latin-1."""
    with open(caminho, encoding='utf-8', errors='replace', newline='') as f:
        yield from csv.DictReader(f, delimiter=';')


def ano_mes(valor):
    partes = (valor or '').split('/')
    if len(partes) != 2:
        return None, None
    try:
        return int(partes[1]), int(partes[0])
    except ValueError:
        return None, None


def inteiro(valor):
    try:
        return int(float(str(valor).replace('.', '').replace(',', '.')))
    except (TypeError, ValueError):
        return 0


def escrever(nome, cabecalho, linhas_dados):
    caminho = os.path.join(AQUI, nome)
    with open(caminho, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(cabecalho)
        w.writerows(linhas_dados)
    print(f'  ✓ {nome}: {len(linhas_dados):,} linhas, '
          f'{os.path.getsize(caminho)/1e6:.2f} MB')


# ------------------------------------------------------------------ etapas

def share_bovino(caminho):
    """Mede, no arquivo que tem espécie, quanto de cada diagnóstico é bovino."""
    por_diag = defaultdict(lambda: [0, 0])
    for row in linhas(caminho):
        ano, _ = ano_mes(row.get('MES_ANO'))
        if not ano or ano < ANO_INI:
            continue
        q = inteiro(row.get('NUMERO_ANIMAIS_ACOMETIDOS'))
        if q <= 0:
            continue
        d = norm_diag(row.get('DIAGNOSTICO'))
        esp = norm_diag(row.get('ESPECIE'))
        bovino = esp.startswith('BOV') or esp.startswith('BUF') or esp in (
            'VACA', 'TOURO', 'NOVILHO', 'NOVILHA', 'BEZERRO', 'BUBALINO')
        por_diag[d][1] += q
        if bovino:
            por_diag[d][0] += q
    return por_diag


def etapa_uf(caminho_doencas, caminho_abates):
    """Nível UF: mantém a métrica original, casos por cabeça abatida."""
    casos = defaultdict(int)
    for row in linhas(caminho_doencas):
        ano, mes = ano_mes(row.get('MES_ANO'))
        if not ano or ano < ANO_INI or not mes:
            continue
        uf = (row.get('UF_PROCEDENCIA') or '').strip().upper()
        if uf not in UFS:
            continue
        q = inteiro(row.get('NUMERO_ANIMAIS_ACOMETIDOS'))
        if q <= 0:
            continue
        d = norm_diag(row.get('DIAGNOSTICO'))
        if d in NAO_SANITARIOS:
            continue
        esp = norm_diag(row.get('ESPECIE'))
        # o painel responde sobre compra de gado: o resto do SIF fica de fora
        if esp.startswith('BOV') or esp in ('VACA', 'TOURO', 'NOVILHO', 'NOVILHA',
                                            'BEZERRO', 'BEZERRA', 'NOVILHAO'):
            esp = 'BOVINOS'
        elif esp.startswith('BUF') or esp == 'BUBALINO':
            esp = 'BUBALINOS'
        else:
            continue
        casos[(ano, mes, uf, esp, canonizar(row.get('DIAGNOSTICO')))] += q

    abates = defaultdict(int)
    for row in linhas(caminho_abates):
        ano, mes = ano_mes(row.get('MES_ANO'))
        if not ano or ano < ANO_INI or not mes:
            continue
        uf = (row.get('UF_PROCEDENCIA') or '').strip().upper()
        if uf not in UFS:
            continue
        cat = norm_diag(row.get('CATEGORIA'))
        # O teste de bubalino vem primeiro de propósito: BUFALO, BUFALA e
        # BUBALINO estão dentro de CAT_BOVINAS, que é o conjunto bovino+bubalino
        # usado como porteira do denominador. Testar BOVINOS antes tornava o
        # ramo bubalino inalcançável e jogava as 29 mil cabeças de abate
        # bubalino do período dentro de BOVINOS — sif_uf_abates.csv saía sem
        # uma linha sequer de BUBALINOS, enquanto o arquivo de doenças tinha 578.
        if cat.startswith('BUF') or cat == 'BUBALINO':
            grupo = 'BUBALINOS'
        elif cat.startswith('BOV') or cat in CAT_BOVINAS:
            grupo = 'BOVINOS'
        else:
            continue
        total = inteiro(row.get('QTD_MACHO')) + inteiro(row.get('QTD_FEMEA'))
        if total > 0:
            abates[(ano, mes, uf, grupo)] += total

    escrever('sif_uf_doencas.csv', ['ano', 'mes', 'uf', 'especie', 'diagnostico', 'casos'],
             sorted([[a, m, u, e, d, q] for (a, m, u, e, d), q in casos.items()]))
    escrever('sif_uf_abates.csv', ['ano', 'mes', 'uf', 'especie', 'abatidos'],
             sorted([[a, m, u, g, q] for (a, m, u, g), q in abates.items()]))


def etapa_municipio(caminho, bovinos):
    """Nível município: só diagnósticos predominantemente bovinos."""
    casos = defaultdict(int)
    lidas = 0
    for row in linhas(caminho):
        lidas += 1
        ano, _ = ano_mes(row.get('MES_ANO'))
        if not ano or ano < ANO_INI:
            continue
        uf = (row.get('UF_PROCEDENCIA') or '').strip().upper()
        if uf not in UFS:
            continue
        d = norm_diag(row.get('DIAGNOSTICO'))
        if d not in bovinos or d in NAO_SANITARIOS:
            continue
        mun = re.sub(r'\s+', ' ', (row.get('MUNICIPIO_PROCEDENCIA') or '').strip())
        if not mun:
            continue
        q = inteiro(row.get('QUANTIDADE'))
        if q > 0:
            casos[(ano, uf, rotulo(mun), canonizar(row.get('DIAGNOSTICO')))] += q
    print(f'  · {lidas:,} linhas lidas no arquivo municipal')
    return casos


def etapa_ibge_rebanho(anos):
    """PPM 3939: efetivo bovino por município, o denominador do nível municipal."""
    fora = []
    for ano in anos:
        url = ('https://apisidra.ibge.gov.br/values/t/3939/n6/all/v/105/'
               f'p/{ano}/c79/2670')
        print(f'  ↓ PPM {ano} …', end='', flush=True)
        dados = json_web(url)[1:]
        n = 0
        for d in dados:
            cod = d.get('D1C')
            valor = d.get('V')
            if not cod or valor in (None, '...', '-', 'X', '..'):
                continue
            nome_uf = d.get('D1N', '')
            nome, _, uf = nome_uf.rpartition(' - ')
            fora.append([cod, uf.strip(), nome.strip(), ano, inteiro(valor)])
            n += 1
        print(f' {n:,} municípios')
    escrever('ibge_rebanho_municipal.csv',
             ['codigo_ibge', 'uf', 'municipio', 'ano', 'cabecas'], fora)
    return fora


def etapa_malha():
    url = ('https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR'
           '?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF')
    print('  ↓ malha das UFs …', end='', flush=True)
    geo = json_web(url)
    caminho = os.path.join(AQUI, 'ibge_malha_uf.geojson')
    with open(caminho, 'w', encoding='utf-8') as f:
        json.dump(geo, f, separators=(',', ':'))
    print(f" {len(geo.get('features', []))} feições, "
          f'{os.path.getsize(caminho)/1e6:.2f} MB')


def main():
    print('SIGSIF — preparação da base real\n')

    print('1. MAPA / PGA-SIGSIF')
    caminhos = {n: baixar(n, u) for n, u in RECURSOS.items()}

    print('\n2. Share bovino por diagnóstico (medido no arquivo de UF)')
    por_diag = share_bovino(caminhos['doencas_uf.csv'])
    bovinos = {d for d, (b, t) in por_diag.items()
               if t >= 500 and b / t >= 0.70 and d not in NAO_SANITARIOS}
    print(f'  · {len(por_diag)} diagnósticos no período; '
          f'{len(bovinos)} predominantemente bovinos e sanitários')

    # grafia mais frequente de cada diagnóstico, para não duplicar na interface
    grafias = defaultdict(Counter)
    for caminho in (caminhos['doencas_uf.csv'], caminhos['doencas_municipio.csv']):
        col = ('NUMERO_ANIMAIS_ACOMETIDOS' if 'uf' in os.path.basename(caminho)
               else 'QUANTIDADE')
        for row in linhas(caminho):
            ano, _ = ano_mes(row.get('MES_ANO'))
            if not ano or ano < ANO_INI:
                continue
            bruto = row.get('DIAGNOSTICO')
            grafias[norm_diag(bruto)][rotulo(bruto)] += inteiro(row.get(col))
    CANON.update({k: v.most_common(1)[0][0] for k, v in grafias.items()})
    print(f'  · {len(CANON)} grafias canonizadas')

    print('\n3. Nível UF (casos por cabeça abatida)')
    etapa_uf(caminhos['doencas_uf.csv'], caminhos['abates_uf.csv'])

    print('\n4. Nível município (casos por cabeça de rebanho)')
    casos_mun = etapa_municipio(caminhos['doencas_municipio.csv'], bovinos)

    print('\n5. IBGE — rebanho bovino municipal (PPM 3939)')
    anos = sorted({a for (a, _, _, _) in casos_mun})
    # a PPM sai com defasagem: os anos do SIF sem PPM herdam o último disponível
    anos_ppm = [a for a in anos if a <= 2024]
    rebanho = etapa_ibge_rebanho(anos_ppm)

    # casa o município do MAPA com o código do IBGE
    por_chave = defaultdict(dict)
    nomes = {}
    for cod, uf, nome, ano, cab in rebanho:
        por_chave[(uf, chave(nome))][ano] = (cod, cab)
        nomes[(uf, chave(nome))] = nome
    ultimo_ppm = max(anos_ppm) if anos_ppm else None

    fora, sem_par, casados = [], defaultdict(int), set()
    for (ano, uf, mun, diag), q in sorted(casos_mun.items()):
        k = chave(mun)
        if (uf, k) in ALIAS:
            k = chave(ALIAS[(uf, k)])
        par = por_chave.get((uf, k))
        if not par:
            sem_par[(uf, mun)] += q
            continue
        cod, cab = par.get(ano) or par.get(ultimo_ppm) or (None, 0)
        if not cod:
            continue
        casados.add((uf, mun))
        fora.append([ano, uf, nomes[(uf, k)], cod, diag, q, cab])

    escrever('sif_municipio_doencas.csv',
             ['ano', 'uf', 'municipio', 'codigo_ibge', 'diagnostico', 'casos', 'rebanho'],
             fora)

    perdidos = sum(sem_par.values())
    total = sum(casos_mun.values())
    print(f'  · {len(casados):,} municípios casados com o IBGE')
    print(f'  · {len(sem_par):,} nomes sem par no IBGE '
          f'({perdidos:,} casos, {perdidos/max(total,1):.2%} do total)')
    for (uf, mun), q in sorted(sem_par.items(), key=lambda x: -x[1])[:8]:
        print(f'      {q:>9,}  {mun}/{uf}')

    print('\n6. IBGE — malha das UFs')
    etapa_malha()

    print('\npronto.')


if __name__ == '__main__':
    main()
