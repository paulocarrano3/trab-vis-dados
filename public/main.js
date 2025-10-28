// Aguarda o conteúdo da página carregar
document.addEventListener('DOMContentLoaded', () => {

    // Configurações globais de margem
    const margin = { top: 30, right: 30, bottom: 70, left: 60 };
    
    // Tooltip (dica flutuante)
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);

    // 1. Gráfico de Corridas por Hora (Barras Comparativas)
    d3.json("/api/hourly").then(data => {
        const container = d3.select("#chart_hourly");
        const width = container.node().getBoundingClientRect().width - margin.left - margin.right;
        const height = 400 - margin.top - margin.bottom;

        const svg = container.append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const data2019 = data.filter(d => d.ano === '2019');
        const data2023 = data.filter(d => d.ano === '2023');
        const horas = data2019.map(d => d.hora);

        const x0 = d3.scaleBand()
            .domain(horas)
            .rangeRound([0, width])
            .paddingInner(0.1);

        const x1 = d3.scaleBand()
            .domain(['2019', '2023'])
            .rangeRound([0, x0.bandwidth()])
            .padding(0.05);

        const y = d3.scaleLinear()
            .domain([0, d3.max(data, d => d.total_corridas)]).nice()
            .rangeRound([height, 0]);

        svg.append("g")
            .selectAll("g")
            .data(data2019.map((d, i) => ({ hora: d.hora, data: [d, data2023[i]] })))
            .join("g")
            .attr("transform", d => `translate(${x0(d.hora)},0)`)
            .selectAll("rect")
            .data(d => d.data)
            .join("rect")
            .attr("x", d => x1(d.ano))
            .attr("y", d => y(d.total_corridas))
            .attr("width", x1.bandwidth())
            .attr("height", d => height - y(d.total_corridas))
            .attr("class", d => d.ano === '2019' ? 'bar-2019' : 'bar-2023')
            .on("mouseover", (event, d) => {
                tooltip.transition().duration(200).style("opacity", .9);
                tooltip.html(`Ano: ${d.ano}<br>Total: ${d.total_corridas.toLocaleString('pt-BR')}`)
                    .style("left", (event.pageX + 5) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => {
                tooltip.transition().duration(500).style("opacity", 0);
            });

        // Eixos
        svg.append("g")
            .attr("class", "axis")
            .attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x0).tickFormat(d => `${d}h`));
        
        svg.append("g")
            .attr("class", "axis")
            .call(d3.axisLeft(y).ticks(null, "s"));
    });

    // 2. Gráficos de Pagamento (Pizza)
    d3.json("/api/payments").then(data => {
        const data2019 = data.filter(d => d.ano === '2019');
        const data2023 = data.filter(d => d.ano === '2023');
        
        drawPieChart(data2019, "#chart_payments_2019");
        drawPieChart(data2023, "#chart_payments_2023");
    });

    // 3. Gráficos de Top Zonas (Barras Horizontais)
    d3.json("/api/top_zones").then(data => {
        const data2019 = data.filter(d => d.ano === '2019').sort((a,b) => a.total_corridas - b.total_corridas);
        const data2023 = data.filter(d => d.ano === '2023').sort((a,b) => a.total_corridas - b.total_corridas);

        drawHBarChart(data2019, "#chart_top_zones_2019", "bar-2019");
        drawHBarChart(data2023, "#chart_top_zones_2023", "bar-2023");
    });

    // 4. Gráfico de Tarifas (Barras Agrupadas Simples)
    d3.json("/api/fares").then(data => {
        drawFaresChart(data, "#chart_fares");
    });

    // --- FUNÇÕES REUTILIZÁVEIS ---

    function drawPieChart(data, elementId) {
        const container = d3.select(elementId);
        const width = container.node().getBoundingClientRect().width;
        const height = 400;
        const radius = Math.min(width, height) / 2;

        const svg = container.append("svg")
            .attr("width", width)
            .attr("height", height)
            .append("g")
            .attr("transform", `translate(${width / 2}, ${height / 2})`);

        const color = d3.scaleOrdinal()
            .domain(data.map(d => d.metodo))
            .range(["#4e79a7", "#f28e2b", "#e15759"]); // Azul, Laranja, Vermelho

        const pie = d3.pie()
            .value(d => d.total)
            .sort(null);

        const arc = d3.arc()
            .innerRadius(0)
            .outerRadius(radius * 0.8);

        const arcs = svg.selectAll("path")
            .data(pie(data))
            .join("path")
            .attr("d", arc)
            .attr("fill", d => color(d.data.metodo))
            .on("mouseover", (event, d) => {
                const percent = (d.data.total / d3.sum(data, d => d.total) * 100).toFixed(1);
                tooltip.transition().duration(200).style("opacity", .9);
                tooltip.html(`${d.data.metodo}: ${percent}%<br>(${d.data.total.toLocaleString('pt-BR')})`)
                    .style("left", (event.pageX + 5) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => {
                tooltip.transition().duration(500).style("opacity", 0);
            });
    }

    function drawHBarChart(data, elementId, barClass) {
        const container = d3.select(elementId);
        const m = { top: 20, right: 30, bottom: 40, left: 150 }; // Margem esquerda maior para labels
        const width = container.node().getBoundingClientRect().width - m.left - m.right;
        const height = 400 - m.top - m.bottom;

        const svg = container.append("svg")
            .attr("width", width + m.left + m.right)
            .attr("height", height + m.top + m.bottom)
            .append("g")
            .attr("transform", `translate(${m.left},${m.top})`);

        const y = d3.scaleBand()
            .domain(data.map(d => d.Zone))
            .range([0, height])
            .padding(0.1);

        const x = d3.scaleLinear()
            .domain([0, d3.max(data, d => d.total_corridas)]).nice()
            .range([0, width]);

        svg.append("g")
            .attr("class", `axis ${barClass}`)
            .selectAll("rect")
            .data(data)
            .join("rect")
            .attr("x", x(0))
            .attr("y", d => y(d.Zone))
            .attr("width", d => x(d.total_corridas))
            .attr("height", y.bandwidth())
            .attr("class", barClass)
            .on("mouseover", (event, d) => {
                tooltip.transition().duration(200).style("opacity", .9);
                tooltip.html(`${d.Zone}<br>Total: ${d.total_corridas.toLocaleString('pt-BR')}`)
                    .style("left", (event.pageX + 5) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => {
                tooltip.transition().duration(500).style("opacity", 0);
            });

        // Eixos
        svg.append("g")
            .attr("class", "axis")
            .attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x).ticks(5, "s"));
            
        svg.append("g")
            .attr("class", "axis")
            .call(d3.axisLeft(y));
    }

    function drawFaresChart(data, elementId) {
        const container = d3.select(elementId);
        const m = { top: 20, right: 30, bottom: 40, left: 60 };
        const width = container.node().getBoundingClientRect().width - m.left - m.right;
        const height = 400 - m.top - m.bottom;

        const svg = container.append("svg")
            .attr("width", width + m.left + m.right)
            .attr("height", height + m.top + m.bottom)
            .append("g")
            .attr("transform", `translate(${m.left},${m.top})`);

        const categories = ['tarifa_media', 'gorjeta_media', 'total_medio'];
        const years = ['2019', '2023'];

        const x0 = d3.scaleBand()
            .domain(categories)
            .range([0, width])
            .padding(0.2);

        const x1 = d3.scaleBand()
            .domain(years)
            .range([0, x0.bandwidth()])
            .padding(0.05);

        const y = d3.scaleLinear()
            .domain([0, d3.max(data, d => d.total_medio) * 1.1]).nice()
            .range([height, 0]);

        const g = svg.selectAll(".group")
            .data(categories)
            .join("g")
            .attr("transform", d => `translate(${x0(d)}, 0)`);

        g.selectAll("rect")
            .data(category => data.map(d => ({ key: category, value: d[category], ano: d.ano })))
            .join("rect")
            .attr("x", d => x1(d.ano))
            .attr("y", d => y(d.value))
            .attr("width", x1.bandwidth())
            .attr("height", d => height - y(d.value))
            .attr("class", d => d.ano === '2019' ? 'bar-2019' : 'bar-2023')
            .on("mouseover", (event, d) => {
                tooltip.transition().duration(200).style("opacity", .9);
                tooltip.html(`Ano: ${d.ano}<br>Valor: $${d.value.toFixed(2)}`)
                    .style("left", (event.pageX + 5) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => {
                tooltip.transition().duration(500).style("opacity", 0);
            });

        // Eixos
        svg.append("g")
            .attr("class", "axis")
            .attr("transform", `translate(0,${height})`)
            .call(d3.axisBottom(x0).tickFormat(d => d.replace('_', ' ')));
            
        svg.append("g")
            .attr("class", "axis")
            .call(d3.axisLeft(y).tickFormat(d => `$${d}`));
    }
});