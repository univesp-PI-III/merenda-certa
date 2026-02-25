# Merenda Certa

Aplicacao web responsiva para gestao de estoque e controle de temperatura da merenda escolar, conforme o plano de acao do PI-III.

## Funcionalidades do MVP

- Cadastro de produtos com nome, unidade e estoque minimo
- Controle de entradas por lote (com validade) e saidas com atualizacao automatica de saldo
- Cadastro de medidores com faixa minima/maxima e ingestao MQTT de leituras
- Indicadores de painel: total de produtos, estoque baixo, movimentacoes e alertas de temperatura
- API REST em JavaScript e banco relacional SQLite

## Stack

- Node.js + Express
- SQLite (better-sqlite3)
- Front-end HTML, CSS e JavaScript puro

## Como executar

```bash
npm install
npm start
```

Acesse `http://localhost:3000`.

## Docker Compose (app + mock MQTT)

```bash
./scripts/compose-up.sh
```

Isso sobe:
- App web em `http://localhost:3000`
- Broker MQTT em `mqtt://localhost:1883`
- Simulador MQTT publicando automaticamente

## Dados de teste

```bash
npm run seed:test
```

Esse comando recria os dados de exemplo (produtos, movimentacoes, medidores e leituras) para facilitar testes dos graficos e dashboards.

## Simulador MQTT

Com a API rodando, execute:

```bash
npm run mqtt:sim
```

O simulador envia leituras para os medidores `medidor-1` a `medidor-4` no broker local iniciado pela aplicacao (`mqtt://127.0.0.1:1883`).

## Endpoints principais

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/products`
- `POST /api/products`
- `GET /api/product-entries`
- `POST /api/product-entries`
- `GET /api/movements`
- `POST /api/movements`
- `GET /api/temperature-meters`
- `POST /api/temperature-meters`
- `PATCH /api/temperature-meters/:id`
- `GET /api/temperature-readings`
- `POST /api/temperature-readings`
- `GET /api/temperature-dashboard`
- `GET /api/analytics/products?days=60`

## Estrutura

- `src/server.js`: API e regras de negocio
- `src/db.js`: conexao e schema do SQLite
- `public/`: interface web responsiva
- `data/`: arquivo do banco SQLite (gerado automaticamente)
