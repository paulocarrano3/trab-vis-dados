const express = require('express');
const duckdb = require('duckdb');
const app = express();
const port = 3000;

// 1. Iniciar o DB em memória
const db = new duckdb.Database(':memory:');

// 2. Função para carregar todos os dados antes de iniciar o servidor
const loadData = () => {
  return new Promise((resolve, reject) => {
    // db.serialize garante que cada comando db.run/db.all
    // termine antes que o próximo comece.
    db.serialize(() => {
      try {
        console.log("Iniciando carregamento dos dados...");
        db.run("INSTALL httpfs; LOAD httpfs;"); 
        
        console.log("Carregando Fev/2019...");
        db.run("CREATE TABLE trips_2019 AS SELECT * FROM read_parquet('data/yellow_tripdata_2019-02.parquet');");
        
        console.log("Carregando Fev/2023...");
        db.run("CREATE TABLE trips_2023 AS SELECT * FROM read_parquet('data/yellow_tripdata_2023-02.parquet');");
        
        console.log("Carregando Zonas...");
        db.run("CREATE TABLE zones AS SELECT * FROM read_csv_auto('data/taxi_zone_lookup.csv');");
        
        console.log("Dados carregados. Verificando contagem...");
        
        // Query 1
        db.all("SELECT COUNT(*) as count FROM trips_2019", (err, res) => {
          if (err) return reject(err); // Se der erro aqui, rejeita a promessa
          console.log(`Corridas Fev/2019: ${res[0].count}`);
        });

        // Query 2 - ESTA É A ÚLTIMA OPERAÇÃO DA FILA
        db.all("SELECT COUNT(*) as count FROM trips_2023", (err, res) => {
          if (err) return reject(err); // Se der erro aqui, rejeita a promessa
          console.log(`Corridas Fev/2023: ${res[0].count}`);
          
          // Como esta é a última coisa a rodar no 'serialize',
          // agora podemos resolver a promessa e dizer que tudo está pronto.
          console.log("Tabelas prontas.");
          resolve(); 
        });

      } catch (err) {
        reject(err);
      }
    });
  });
};

// 3. Servir os arquivos do Frontend (HTML, CSS, JS)
app.use(express.static('public'));

// 4. --- NOSSAS APIs DE DADOS ---
// Todo pré-processamento/auditoria é feito aqui, nas queries SQL.
const PRE_PROCESSING_FILTER = "WHERE total_amount > 0 AND trip_distance > 0";

// API: Variação Temporal (Corridas por Hora)
app.get('/api/hourly', (req, res) => {
  const query = `
    SELECT '2019' as ano, strftime(tpep_pickup_datetime, '%H') as hora, 
        CAST(COUNT(*) AS INTEGER) as total_corridas -- <-- MUDANÇA AQUI
    FROM trips_2019
    ${PRE_PROCESSING_FILTER}
    GROUP BY hora
    UNION ALL
    SELECT '2023' as ano, strftime(tpep_pickup_datetime, '%H') as hora, 
        CAST(COUNT(*) AS INTEGER) as total_corridas -- <-- MUDANÇA AQUI
    FROM trips_2023
    ${PRE_PROCESSING_FILTER}
    GROUP BY hora
    ORDER BY hora, ano;
  `;
  db.all(query, (err, data) => {
    if (err) res.status(500).json({ error: err.message });
    res.json(data);
  });
});

// API: Métodos de Pagamento
app.get('/api/payments', (req, res) => {
  const query = `
    WITH all_payments AS (
      SELECT '2019' as ano, 
             CASE 
               WHEN payment_type = 1 THEN 'Cartão'
               WHEN payment_type = 2 THEN 'Dinheiro'
               ELSE 'Outros'
             END as metodo,
             CAST(COUNT(*) AS INTEGER) as total -- <-- MUDANÇA AQUI
      FROM trips_2019
      ${PRE_PROCESSING_FILTER}
      GROUP BY metodo
      UNION ALL
      SELECT '2023' as ano, 
             CASE 
               WHEN payment_type = 1 THEN 'Cartão'
               WHEN payment_type = 2 THEN 'Dinheiro'
               ELSE 'Outros'
             END as metodo,
             CAST(COUNT(*) AS INTEGER) as total -- <-- MUDANÇA AQUI
      FROM trips_2023
      ${PRE_PROCESSING_FILTER}
      GROUP BY metodo
    )
    SELECT * FROM all_payments;
  `;
  db.all(query, (err, data) => {
    if (err) res.status(500).json({ error: err.message });
    res.json(data);
  });
});

// API: Composição da Tarifa (Valores Médios)
// Esta API não precisa de mudança, pois AVG() retorna DOUBLE (float), não BIGINT
app.get('/api/fares', (req, res) => {
  const query = `
    SELECT '2019' as ano,
        AVG(fare_amount) as tarifa_media,
        AVG(tip_amount) as gorjeta_media,
        AVG(total_amount) as total_medio
    FROM trips_2019
    ${PRE_PROCESSING_FILTER} AND fare_amount > 0
    UNION ALL
    SELECT '2023' as ano,
        AVG(fare_amount) as tarifa_media,
        AVG(tip_amount) as gorjeta_media,
        AVG(total_amount) as total_medio
    FROM trips_2023
    ${PRE_PROCESSING_FILTER} AND fare_amount > 0;
  `;
  db.all(query, (err, data) => {
    if (err) res.status(500).json({ error: err.message });
    res.json(data);
  });
});

// API: Top 5 Zonas de Partida (para os dois anos)
app.get('/api/top_zones', (req, res) => {
  const query = `
    WITH ranked_zones AS (
      SELECT '2019' as ano, z.Zone, 
          CAST(COUNT(*) AS INTEGER) as total_corridas -- <-- MUDANÇA AQUI
      FROM trips_2019 t JOIN zones z ON t.PULocationID = z.LocationID
      ${PRE_PROCESSING_FILTER} AND z.Borough != 'Unknown'
      GROUP BY z.Zone
      ORDER BY total_corridas DESC
      LIMIT 5
    ),
    ranked_zones_2023 AS (
      SELECT '2023' as ano, z.Zone, 
          CAST(COUNT(*) AS INTEGER) as total_corridas -- <-- MUDANÇA AQUI
      FROM trips_2023 t JOIN zones z ON t.PULocationID = z.LocationID
      ${PRE_PROCESSING_FILTER} AND z.Borough != 'Unknown'
      GROUP BY z.Zone
      ORDER BY total_corridas DESC
      LIMIT 5
    )
    SELECT * FROM ranked_zones
    UNION ALL
    SELECT * FROM ranked_zones_2023;
  `;
  db.all(query, (err, data) => {
    if (err) res.status(500).json({ error: err.message });
    res.json(data);
  });
});


// 5. Iniciar o servidor
loadData().then(() => {
  app.listen(port, () => {
    console.log(`Servidor rodando! Acesse http://localhost:${port} no seu navegador.`);
  });
}).catch((err) => {
    console.error("Erro fatal ao carregar dados ou iniciar servidor:", err);
});