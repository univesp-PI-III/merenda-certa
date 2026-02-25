# Merenda Certa

Aplicação web responsiva para gestão de estoque e controle de temperatura da merenda escolar, conforme o plano de ação do PI-III.

## Funcionalidades do MVP

- Cadastro de produtos com nome, unidade e estoque mínimo
- Controle de entradas por lote (com validade) e saídas com atualização automática de saldo
- Cadastro de medidores com faixa mínima/máxima e ingestão MQTT de leituras
- Indicadores de painel: total de produtos, estoque baixo, movimentações e alertas de temperatura
- API REST em JavaScript e banco relacional SQLite

## Stack

- Node.js + Express
- SQLite (better-sqlite3)
- Front-end HTML, CSS e JavaScript puro

## Documentação

- [Arquitetura do Projeto](./PROJECT_ARCHITECTURE.md)
- [Estrutura do Banco de Dados](./DATABASE_STRUCTURE.md)

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
- App web em `http://localhost`
- Broker MQTT em `mqtt://localhost:1883`
- Simulador MQTT publicando automaticamente
- Carga de dados de teste no startup do serviço `app` (`npm run seed:test`)

## Dados de teste

```bash
npm run seed:test
```

Esse comando recria os dados de exemplo (produtos, movimentações, medidores e leituras) para facilitar testes dos gráficos e dashboards.

## Simulador MQTT

Com a API rodando, execute:

```bash
npm run mqtt:sim
```

O simulador envia leituras para os medidores `medidor-1` a `medidor-4` no broker local iniciado pela aplicação (`mqtt://127.0.0.1:1883`).

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

- `src/server.js`: API e regras de negócio
- `src/db.js`: conexão e schema do SQLite
- `public/`: interface web responsiva
- `data/`: arquivo do banco SQLite (gerado automaticamente)
