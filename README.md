# Mapa de Knowledge 3D

Ferramenta pessoal para capturar ideias e tarefas soltas e visualizar conexões entre elas como um grafo 3D navegável. 100% client-side — sem login, sem backend, sem banco de dados.

## Melhorias experimentais — exploração de conexões

Esta branch adiciona recursos inspirados na navegação por grafos do Obsidian, mantendo o motor 3D original:

- **Pesquisar conceitos** pelo título, descrição ou tags; pressione Enter para centralizar no primeiro resultado.
- **Clicar em um ponto** para abrir seus detalhes e destacar até três níveis de vizinhança.
- **Explorar conceitos adjacentes** pelo painel, criar novas ligações e remover ligações existentes.
- **Enquadrar** a rede inteira sem resetar seus dados.
- **Salvar automaticamente** os dados no `localStorage` deste navegador; posições, ideias e conexões são preservadas após recarregar a página.
- **Exportar JSON** continua sendo necessário para backup e troca entre dispositivos. O armazenamento local não sincroniza com Notion, ChatGPT ou outros navegadores.

Os vínculos destacados são **relações explicitamente cadastradas ou importadas**. Não representam automaticamente similaridade semântica gerada por IA.

## 1. Testar localmente

Como o app usa ES Modules (`<script type="module">`), não dá para abrir `index.html` direto com duplo clique (o navegador bloqueia `fetch`/imports em `file://`). É preciso servir os arquivos com um servidor estático simples:

```bash
# opção 1: Python (já vem instalado na maioria dos sistemas)
python -m http.server 8000

# opção 2: Node, sem instalar nada globalmente
npx serve .
```

Depois abra `http://localhost:8000` (ou a porta indicada) no navegador.

## 2. Publicar no GitHub Pages

1. Crie um repositório no GitHub e suba todos os arquivos deste projeto (incluindo a pasta `data/`).
2. No repositório, vá em **Settings → Pages**.
3. Em "Source", selecione a branch principal (`main`) e a pasta raiz (`/`).
4. Salve. Em alguns minutos o site estará disponível em `https://seu-usuario.github.io/nome-do-repo/`.

Não há etapa de build — os arquivos são servidos exatamente como estão. As bibliotecas (`three`, `3d-force-graph`, `troika-three-text`) são carregadas via CDN (esm.sh) através do import map em `index.html`, então não é necessário `npm install`.

## 3. Formato do arquivo JSON (exportar/importar)

O botão **Exportar** salva o estado atual completo (incluindo as posições x/y/z que você organizou manualmente) em um arquivo `.json` com esta estrutura:

```json
{
  "nodes": [
    {
      "id": "0",
      "label": "Título curto",
      "text": "Descrição mais completa da ideia",
      "category": "bjj",
      "status": "pending",
      "tags": ["tag1", "tag2"],
      "x": 1.2, "y": -3.4, "z": 0.8
    }
  ],
  "links": [
    { "source": "0", "target": "3" }
  ]
}
```

- `category`: `bjj`, `financeiro`, `negocio`, `organizacao`, `ferramenta` ou `outra`.
- `status`: `pending`, `progress` ou `done`.
- `x`/`y`/`z` são opcionais — se omitidos (ou inválidos), o app gera uma posição automática próxima aos nós conectados, evitando que o grafo "exploda".

Ao importar um `.json`, você escolhe entre **mesclar** (adiciona/atualiza nós sem remover os existentes) ou **substituir** (descarta o estado atual e carrega só o importado).

## 4. Formato do arquivo .md / .txt (importação rápida)

Você também pode importar um arquivo de texto simples no formato de captura rápida:

```
[2026-06-10] Ideia de criar uma skill para decupagem de vídeo
tags: video, skill, ferramenta

[2026-06-12] Replicar fórmula ACS em canal próprio
tags: negocio, acs
```

Cada bloco `[DATA] texto` (a data pode ser qualquer texto entre colchetes) seguido de uma linha `tags: ...` se torna um nó novo. O app gera automaticamente uma conexão entre dois nós sempre que eles compartilham **2 ou mais tags** em comum. Esse formato é pensado para grandes volumes — para milhares de entradas, prefira agrupar por temas amplos nas tags, já que a geração de conexões compara todos os pares de nós.

## Uso geral

- Arraste o fundo para girar a cena; scroll (ou pinça no celular) para zoom.
- Arraste um nó específico para reposicioná-lo manualmente.
- Toque/clique rápido em um nó mostra a descrição completa.
- Use o painel lateral para filtrar por tag — os nós relacionados ficam em destaque, os demais ficam translúcidos (sem sair do lugar).
- "Resetar física" reaquenta a simulação se o layout ficar confuso após muitas edições.
