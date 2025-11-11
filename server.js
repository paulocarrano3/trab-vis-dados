const express = require('express');
const duckdb = require('duckdb');
const app = express();
const port = 3000;

const db = new duckdb.Database(':memory:');

const loadData = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      try {
        db.run("INSTALL httpfs; LOAD httpfs;"); 
        db.run("CREATE TABLE trips_2019 AS SELECT * FROM read_parquet('data/yellow_tripdata_2019-02.parquet');");
        db.run("CREATE TABLE trips_2023 AS SELECT * FROM read_parquet('data/yellow_tripdata_2023-02.parquet');");
        db.run("CREATE TABLE zones AS SELECT * FROM read_csv_auto('data/taxi_zone_lookup.csv');");
        
        db.all("SELECT COUNT(*) as count FROM trips_2019", (err, res) => {
          if (err) return reject(err);
          resolve(); 
        });

        db.all("SELECT COUNT(*) as count FROM trips_2023", (err, res) => {
          if (err) return reject(err);
          resolve(); 
        });

      } catch (err) {
        reject(err);
      }
    });
  });
};

app.use(express.static('public'));

const PRE_PROCESSING_FILTER = "WHERE total_amount > 0 AND trip_distance > 0";

app.get('/api/hourly', (req, res) => {
  const query = `
    SELECT '2019' as ano, strftime(tpep_pickup_datetime, '%H') as hora, 
        CAST(COUNT(*) AS INTEGER) as total_corridas
    FROM trips_2019
    ${PRE_PROCESSING_FILTER}
    GROUP BY hora
    UNION ALL
    SELECT '2023' as ano, strftime(tpep_pickup_datetime, '%H') as hora, 
        CAST(COUNT(*) AS INTEGER) as total_corridas
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

app.get('/api/weekly', (req, res) => {
    const query = `
      SELECT '2019' as ano, strftime(tpep_pickup_datetime, '%w') as dia_semana, 
          CAST(COUNT(*) AS INTEGER) as total_corridas
      FROM trips_2019
      ${PRE_PROCESSING_FILTER}
      GROUP BY dia_semana
      UNION ALL
      SELECT '2023' as ano, strftime(tpep_pickup_datetime, '%w') as dia_semana, 
          CAST(COUNT(*) AS INTEGER) as total_corridas
      FROM trips_2023
      ${PRE_PROCESSING_FILTER}
      GROUP BY dia_semana
      ORDER BY dia_semana, ano;
    `;
    db.all(query, (err, data) => {
      if (err) res.status(500).json({ error: err.message });
      res.json(data);
    });
  });

app.get('/api/payments', (req, res) => {
  const query = `
    WITH all_payments AS (
      SELECT '2019' as ano, 
             CASE 
               WHEN payment_type = 1 THEN 'Cartão'
               WHEN payment_type = 2 THEN 'Dinheiro'
               ELSE 'Outros'
             END as metodo,
             CAST(COUNT(*) AS INTEGER) as total
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
             CAST(COUNT(*) AS INTEGER) as total
      FROM trips_2023
      ${PRE_PROCESSING_FILTER}
      GROUP BY metodo
    )
    SELECT * FROM all_payments
    -- ADIÇÃO: Força a ordem dos métodos para consistência
    ORDER BY ano,
             CASE
               WHEN metodo = 'Cartão' THEN 1
               WHEN metodo = 'Dinheiro' THEN 2
               ELSE 3
             END;
  `;
  db.all(query, (err, data) => {
    if (err) res.status(500).json({ error: err.message });
    res.json(data);
  });
});

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

app.get('/api/top_zones', (req, res) => {
  const query = `
    WITH ranked_zones AS (
      SELECT '2019' as ano, z.Zone, 
          CAST(COUNT(*) AS INTEGER) as total_corridas
      FROM trips_2019 t JOIN zones z ON t.PULocationID = z.LocationID
      ${PRE_PROCESSING_FILTER} AND z.Borough != 'Unknown'
      GROUP BY z.Zone
      ORDER BY total_corridas DESC
      LIMIT 5
    ),
    ranked_zones_2023 AS (
      SELECT '2023' as ano, z.Zone, 
          CAST(COUNT(*) AS INTEGER) as total_corridas
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

loadData().then(() => {
  app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
  });
}).catch((err) => {
    console.error("Erro!", err);
});