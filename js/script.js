const DATA_PATH = "data/data.csv";

const tooltip = d3.select("#tooltip");
const visContainer = d3.select("#vis");
const countrySelect = d3.select("#countrySelect");
const resetButton = d3.select("#resetButton");

const countryColor = d3.scaleOrdinal(d3.schemeTableau10);

d3.csv(DATA_PATH)
    .then(raw => {
        const cleaned = raw
            .map(normalizeRow)
            .filter(d =>
                d &&
                d.country &&
                Number.isFinite(d.year) &&
                Number.isFinite(d.valueMt) &&
                d.frequency === "A" &&
                d.pollutantCode === "GHG"
            );

        if (!cleaned.length) {
            showEmptyMessage("No usable rows were found after filtering for annual greenhouse gas data.");
            return;
        }

        const {
            countryYearTotals,
            sectorRows,
            latestYear,
            top12Latest,
            top5Latest,
            seriesForTop5,
            defaultCountry
        } = buildDerivedData(cleaned);

        if (!latestYear || !top12Latest.length) {
            showEmptyMessage("The file loaded, but there were not enough country-year totals to draw the charts.");
            return;
        }

        buildCountryDropdown(top12Latest.map(d => d.country), defaultCountry);

        drawAll({
            latestYear,
            countryYearTotals,
            seriesForTop5,
            top12Latest,
            sectorRows,
            selectedCountry: defaultCountry
        });

        countrySelect.on("change", function () {
            drawAll({
                latestYear,
                countryYearTotals,
                seriesForTop5,
                top12Latest,
                sectorRows,
                selectedCountry: this.value
            });
        });

        resetButton.on("click", function () {
            countrySelect.property("value", defaultCountry);
            drawAll({
                latestYear,
                countryYearTotals,
                seriesForTop5,
                top12Latest,
                sectorRows,
                selectedCountry: defaultCountry
            });
        });
    })
    .catch(error => {
        console.error(error);
        showEmptyMessage(
            "The CSV could not be loaded. Make sure the file is stored at data/data.csv and that you are serving the page from a local web server."
        );
    });

function normalizeRow(row) {
    const country = row["Reference area"] || row["REF_AREA"];
    const frequency = row["FREQ"] || row["Frequency of observation"];
    const pollutantCode = row["POLLUTANT"] || "";
    const pollutantLabel = row["Pollutant"] || "";
    const measureCode = row["MEASURE"] || "";
    const measureLabel = row["Measure"] || "";
    const unitCode = row["UNIT_MEASURE"] || "";
    const year = +row["TIME_PERIOD"];
    const rawValue = +row["OBS_VALUE"];
    const unitMultiplier = +row["UNIT_MULT"];

    if (!country || !Number.isFinite(year) || !Number.isFinite(rawValue)) {
        return null;
    }

    // Convert to million tonnes CO2-equivalent (MtCO2e)
    // Mt = OBS_VALUE * 10^(UNIT_MULT) / 1,000,000
    const valueMt = rawValue * Math.pow(10, Number.isFinite(unitMultiplier) ? unitMultiplier : 0) / 1e6;

    return {
        country,
        frequency,
        pollutantCode,
        pollutantLabel,
        measureCode,
        measureLabel,
        unitCode,
        year,
        valueMt
    };
}

function buildDerivedData(rows) {
    const greenhouseRows = rows.filter(d =>
        d.pollutantCode === "GHG" &&
        d.frequency === "A" &&
        d.unitCode === "T_CO2E"
    );

    const totalRows = greenhouseRows.filter(d => isTotalMeasure(d.measureCode, d.measureLabel));
    const nonTotalRows = greenhouseRows.filter(d => !isTotalMeasure(d.measureCode, d.measureLabel));

    const totalMap = new Map();
    totalRows.forEach(d => {
        totalMap.set(`${d.country}|${d.year}`, d.valueMt);
    });

    const summedSectorMap = d3.rollup(
        nonTotalRows,
        values => d3.sum(values, d => d.valueMt),
        d => d.country,
        d => d.year
    );

    const countryYearTotals = [];

    const allCountryYears = new Set();
    greenhouseRows.forEach(d => allCountryYears.add(`${d.country}|${d.year}`));

    for (const key of allCountryYears) {
        const [country, yearText] = key.split("|");
        const year = +yearText;
        const explicitTotal = totalMap.get(key);
        const sectorSum = summedSectorMap.get(country)?.get(year);

        const valueMt = Number.isFinite(explicitTotal) ? explicitTotal : sectorSum;

        if (Number.isFinite(valueMt)) {
            countryYearTotals.push({
                country,
                year,
                valueMt,
                sourceType: Number.isFinite(explicitTotal) ? "explicit-total-row" : "sum-of-sectors"
            });
        }
    }

    const latestYear = d3.max(countryYearTotals, d => d.year);

    const latestRows = countryYearTotals
        .filter(d => d.year === latestYear)
        .sort((a, b) => d3.descending(a.valueMt, b.valueMt));

    const top12Latest = latestRows.slice(0, 12);
    const top5Latest = latestRows.slice(0, 5);
    const top5Countries = top5Latest.map(d => d.country);

    const seriesForTop5 = top5Countries.map(country => {
        return {
            country,
            values: countryYearTotals
                .filter(d => d.country === country)
                .sort((a, b) => d3.ascending(a.year, b.year))
        };
    });

    const defaultCountry = top12Latest.length ? top12Latest[0].country : latestRows[0]?.country;

    return {
        countryYearTotals,
        sectorRows: nonTotalRows,
        latestYear,
        top12Latest,
        top5Latest,
        seriesForTop5,
        defaultCountry
    };
}

function isTotalMeasure(code, label) {
    const text = `${code} ${label}`.toLowerCase().trim();

    return (
        /^tot/.test(String(code).toLowerCase()) ||
        /\btotal\b/.test(text) ||
        /\ball sources\b/.test(text) ||
        /\btotal emissions\b/.test(text) ||
        /\boverall\b/.test(text)
    );
}

function buildCountryDropdown(countries, selectedCountry) {
    countrySelect.selectAll("option").remove();

    countrySelect
        .selectAll("option")
        .data(countries)
        .enter()
        .append("option")
        .attr("value", d => d)
        .property("selected", d => d === selectedCountry)
        .text(d => d);
}

function drawAll({ latestYear, countryYearTotals, seriesForTop5, top12Latest, sectorRows, selectedCountry }) {
    visContainer.html("");

    drawTrendChart(seriesForTop5, latestYear);
    drawSectorChart(sectorRows, selectedCountry, latestYear);
}

function drawTrendChart(seriesData, latestYear) {
    const card = createChartCard(
        "1) Emissions over time for OECD and the four largest emitters in the latest year",
        `This line chart shows long-term trends for the countries with the highest greenhouse gas emissions in ${latestYear}.`,
    );

    const width = 1000;
    const height = 470;
    const margin = { top: 18, right: 150, bottom: 55, left: 80 };

    const svg = card
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`);

    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const allValues = seriesData.flatMap(d => d.values);
    const x = d3.scaleLinear()
        .domain(d3.extent(allValues, d => d.year))
        .range([0, plotWidth]);

    const y = d3.scaleLinear()
        .domain([0, d3.max(allValues, d => d.valueMt)]).nice()
        .range([plotHeight, 0]);

    countryColor.domain(seriesData.map(d => d.country));

    g.append("g")
        .attr("class", "grid")
        .call(d3.axisLeft(y).ticks(6).tickSize(-plotWidth).tickFormat(""));

    g.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${plotHeight})`)
        .call(d3.axisBottom(x).tickFormat(d3.format("d")));

    g.append("g")
        .attr("class", "axis")
        .call(d3.axisLeft(y).ticks(6));

    svg.append("text")
        .attr("x", margin.left + plotWidth / 2)
        .attr("y", height - 10)
        .attr("text-anchor", "middle")
        .text("Year");

    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -(margin.top + plotHeight / 2))
        .attr("y", 20)
        .attr("text-anchor", "middle")
        .text("Emissions (MtCO₂e)");

    const line = d3.line()
        .x(d => x(d.year))
        .y(d => y(d.valueMt));

    const series = g.selectAll(".country-series")
        .data(seriesData)
        .enter()
        .append("g")
        .attr("class", "country-series");

    series.append("path")
        .attr("fill", "none")
        .attr("stroke", d => countryColor(d.country))
        .attr("stroke-width", 2.5)
        .attr("d", d => line(d.values));

    series.selectAll("circle")
        .data(d => d.values.map(v => ({ ...v, country: d.country })))
        .enter()
        .append("circle")
        .attr("cx", d => x(d.year))
        .attr("cy", d => y(d.valueMt))
        .attr("r", 3.2)
        .attr("fill", d => countryColor(d.country))
        .on("mousemove", (event, d) => {
            showTooltip(event, `
                <strong>${d.country}</strong><br>
                Year: ${d.year}<br>
                Emissions: ${formatMt(d.valueMt)}
            `);
        })
        .on("mouseleave", hideTooltip);

    // direct labels at the end
    series.append("text")
        .datum(d => {
            const last = d.values[d.values.length - 1];
            return {
                country: d.country,
                year: last.year,
                valueMt: last.valueMt
            };
        })
        .attr("x", d => x(d.year) + 8)
        .attr("y", d => y(d.valueMt) + 4)
        .attr("fill", d => countryColor(d.country))
        .style("font-size", "12px")
        .style("font-weight", "600")
        .text(d => d.country);
}

function drawSectorChart(sectorRows, selectedCountry, latestYear) {
    const card = createChartCard(
        `2) Sector breakdown for ${selectedCountry} in ${latestYear}`,
        "This chart shows the largest contributing source categories for the selected country. Hover to see the exact numbers for each sector!",
    );

    const selected = sectorRows
        .filter(d => d.country === selectedCountry && d.year === latestYear)
        .map(d => ({
            ...d,
            cleanLabel: cleanMeasureLabel(d.measureLabel)
        }));

    if (!selected.length) {
        card.append("div")
            .attr("class", "empty-message")
            .text(`No sector-level rows were available for ${selectedCountry} in ${latestYear}.`);
        return;
    }

    const aggregated = Array.from(
        d3.rollup(
            selected,
            values => d3.sum(values, d => d.valueMt),
            d => d.cleanLabel
        ),
        ([sector, valueMt]) => ({ sector, valueMt })
    )
        .sort((a, b) => d3.descending(a.valueMt, b.valueMt))
        .slice(0, 10);

    const width = 1000;
    const height = 560;
    const margin = { top: 12, right: 24, bottom: 50, left: 260 };

    const svg = card
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`);

    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const y = d3.scaleBand()
        .domain(aggregated.map(d => d.sector))
        .range([0, plotHeight])
        .padding(0.22);

    const x = d3.scaleLinear()
        .domain([0, d3.max(aggregated, d => d.valueMt)]).nice()
        .range([0, plotWidth]);

    g.append("g")
        .attr("class", "grid")
        .attr("transform", `translate(0,${plotHeight})`)
        .call(d3.axisBottom(x).ticks(6).tickSize(-plotHeight).tickFormat(""));

    g.selectAll(".sector-bar")
        .data(aggregated)
        .enter()
        .append("rect")
        .attr("class", "sector-bar")
        .attr("x", 0)
        .attr("y", d => y(d.sector))
        .attr("width", d => x(d.valueMt))
        .attr("height", y.bandwidth())
        .attr("rx", 4)
        .attr("fill", "#72b7b2")
        .on("mousemove", (event, d) => {
            showTooltip(event, `
                <strong>${selectedCountry}</strong><br>
                Sector: ${d.sector}<br>
                Year: ${latestYear}<br>
                Emissions: ${formatMt(d.valueMt)}
            `);
        })
        .on("mouseleave", hideTooltip);

    g.append("g")
        .attr("class", "axis")
        .call(d3.axisLeft(y));

    g.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${plotHeight})`)
        .call(d3.axisBottom(x).ticks(6));

    svg.append("text")
        .attr("x", margin.left + plotWidth / 2)
        .attr("y", height - 10)
        .attr("text-anchor", "middle")
        .text("Emissions (MtCO₂e)");
}

function createChartCard(title, subtitle, caption) {
    const card = visContainer.append("section").attr("class", "chart-card");
    card.append("h2").text(title);
    card.append("p").attr("class", "chart-subtitle").text(subtitle);
    card.append("p").attr("class", "chart-caption").text(caption);
    return card;
}

function cleanMeasureLabel(label) {
    if (!label) return "Unknown sector";

    return label
        .replace(/^\d+(\.\d+)*\s*/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function formatMt(value) {
    return `${d3.format(",.1f")(value)} MtCO₂e`;
}

function shortFormatMt(value) {
    if (value >= 1000) {
        return `${d3.format(",.0f")(value)} Mt`;
    }
    return `${d3.format(",.1f")(value)} Mt`;
}

function showTooltip(event, html) {
    tooltip
        .classed("hidden", false)
        .html(html)
        .style("left", `${event.clientX + 14}px`)
        .style("top", `${event.clientY + 14}px`);
}

function hideTooltip() {
    tooltip.classed("hidden", true);
}

function showEmptyMessage(message) {
    visContainer.html("");
    visContainer.append("div").attr("class", "empty-message").text(message);
}