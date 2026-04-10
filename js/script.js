const DATA_PATH = "data/data.csv";

const tooltip = d3.select("#tooltip");
const visContainer = d3.select("#vis");
const visBlackHat = d3.select('#visBlackHat');
const countrySelect = d3.select("#countrySelect");
const categorySelect = d3.select("#categorySelect");
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

        const cleaned_for_black_hat = raw
            .map(normalizeRow)
            .filter(d =>
                d &&
                d.country &&
                Number.isFinite(d.year) &&
                Number.isFinite(d.valueMt) &&
                d.frequency === "A"
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

        const bh_data = buildDerivedDataBlack(cleaned_for_black_hat);

        if (!latestYear || !top12Latest.length) {
            showEmptyMessage("The file loaded, but there were not enough country-year totals to draw the charts.");
            return;
        }

        const cat_map = {'Sectors': 'sector','Greenhouse Gases': 'ghg'};

        buildCountryDropdown(top12Latest.map(d => d.country), defaultCountry);
        buildCatDropdown(['Sectors', 'Greenhouse Gases'], 'Sectors');
        console.log("cat. breakdown", categorySelect)

        drawAll({
            latestYear,
            countryYearTotals,
            seriesForTop5,
            top12Latest,
            sectorRows,
            selectedCountry: defaultCountry
        });

        drawBlackHat(bh_data, 'sector');

        categorySelect.on("change", function () {
            const selectedCat = cat_map[this.value];
            console.log("Selected category for black hat chart:", selectedCat);
            drawBlackHat(bh_data, selectedCat);
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

function buildCatDropdown(categories, selectedCategory) {
    categorySelect.selectAll("option").remove();

    categorySelect
        .selectAll("option")
        .data(categories)
        .enter()
        .append("option")
        .attr("value", d => d)
        .property("selected", d => d === selectedCategory)
        .text(d => d);
}

function drawAll({ latestYear, countryYearTotals, seriesForTop5, top12Latest, sectorRows, selectedCountry }) {
    visContainer.html("");

    drawTrendChart(seriesForTop5, latestYear);
    drawSectorChart(sectorRows, selectedCountry, latestYear);
}

function drawBlackHat(derivedData, detail_type='ghg', focusMode = 'false') {
    visBlackHat.html("");
    drawBlackHatChart(derivedData, detail_type, focusMode);
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

function createChartCard(title, subtitle, caption, blackhat=false) {
    let card = null;
    if (blackhat){
        card = visBlackHat.append("section").attr("class", "chart-card");
    }else{
        card = visContainer.append("section").attr("class", "chart-card");
    }
    card.append("h2").text(title);
    card.append("p").attr("class", "chart-subtitle").text(subtitle);
    card.append("p").attr("class", "chart-caption").text(caption);
    return card;
}



function buildDerivedDataBlack(rows) {
    const TARGET_COUNTRIES = ["United States", "Russia", "Brazil", "Algeria", "Nepal"];
    const TOP_LEVEL_SECTORS = ["1", "2", "3", "5"]; // Strict exclusion of LULUCF
    const TARGET_GASES = ["CO2", "CH4", "N2O", "PFC", "HFC", "SF6"];

    // Base filter: Only target countries, target years, and the 4 specific sectors
    const baseRows = rows.filter(d =>
        d.frequency === "A" &&
        TARGET_COUNTRIES.includes(d.country) &&
        d.year >= 2005 &&
        d.year <= 2022 &&
        TOP_LEVEL_SECTORS.includes(d.measureCode)
    );

    // Split the data into aggregated sector totals and specific gases
    const sectorRows = baseRows.filter(d => d.pollutantCode === "GHG" );
    const gasRows = baseRows.filter(d => TARGET_GASES.includes(d.pollutantCode));

    // console.log("gas rows for black hat chart:", gasRows);

    const summedSectorMap = d3.rollup(
        sectorRows,
        values => d3.sum(values, d => d.valueMt),
        d => d.country,
        d => d.year
    );

    const countryYearTotals = [];
    const allCountryYears = new Set();
    sectorRows.forEach(d => allCountryYears.add(`${d.country}|${d.year}`));

    for (const key of allCountryYears) {
        const [countryName, yearText] = key.split("|");
        const year = +yearText;
        const sectorSum = summedSectorMap.get(countryName)?.get(year);

        if (Number.isFinite(sectorSum)) {
            countryYearTotals.push({
                country: countryName,
                year,
                valueMt: Math.max(sectorSum, 10),
                sourceType: "sum-of-top-level-sectors-excluding-lulucf"
            });
        }
    }

    console.log("Derived data:", {
        countryYearTotals,
        sectorRows,
        gasRows
    });

    return {
        countryYearTotals,
        sectorRows,
        gasRows
    };

}


function drawBlackHatChart(derivedData, detail_type='ghg', focusMode = 'false') {
    const card = createChartCard(
        "Absolute Emissions by Continents and A Categorical Breakdown - Trend and Contributors",
        "What is causing global warming?",
        "One representative selected from each continent: US, Russia, Brazil, Algeria, and Nepal (2005-2022)",
        blackhat = true
    );

    const width = 800;
    const height = 600;
    const margin = { top: 40, right: 120, bottom: 60, left: 60 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const extraTopOffset = 80;

    card.append("svg")
        .attr("viewBox", `0 ${margin.top} ${width} ${40}`)
        .style("width", "100%")
        .style("height", "auto")

    const svg = card.append("svg")
        .attr("viewBox", `0 ${extraTopOffset+20} ${width} ${plotHeight}`)
        .style("width", "100%")
        .style("height", "auto")
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // const graph_svg = svg.append("g").attr('class', 'graph_layer');

    const { countryYearTotals, sectorRows, gasRows } = derivedData;
    const data = [];
    const years = d3.range(2005, 2022+1);

    const codeMap = {
        "United States": "us",
        "Russia": "russia",
        "Brazil": "brazil",
        "Algeria": "algeria",
        "Nepal": "nepal"
    };

    // Create Custom Data Structure for Black Hat Chart (const data = [];)
    years.forEach(year => {
        const yearObj = { year: year, sector_bd: {}, gas_bd: {}};

        ["United States", "Russia", "Brazil", "Algeria", "Nepal"].forEach(countryName => {
            const key = codeMap[countryName];
            const totalRecord = countryYearTotals.find(d => d.country === countryName && d.year === year);
            yearObj[key] = totalRecord ? totalRecord.valueMt : 10;

            const sectors = sectorRows.filter(d => d.country === countryName && d.year === year);
            const bd = { energy: 0, industrial: 0, agriculture: 0, waste: 0, other: 0, sum: 0 };

            sectors.forEach(s => {
                const codeStr = (s.measureCode || "").toString();
                bd.sum += s.valueMt;
                if (codeStr === "1") bd.energy += s.valueMt;
                else if (codeStr === "2") bd.industrial += s.valueMt;
                else if (codeStr === "3") bd.agriculture += s.valueMt;
                else if (codeStr === "5") bd.waste += s.valueMt;
                else bd.other += s.valueMt;
            });

            yearObj.sector_bd[key] = bd;

            const sectors_gas = gasRows.filter(d => d.country === countryName && d.year === year);
            const bd_gas = { co2: 0, ch4: 0, n2o: 0, other: 0, sum: 0 };
            sectors_gas.forEach(s => {
                const codeStr = (s.pollutantCode || "").toString();
                bd_gas.sum += s.valueMt;
                if (codeStr === "CO2") bd_gas.co2 += s.valueMt;
                else if (codeStr === "CH4") bd_gas.ch4 += s.valueMt;
                else if (codeStr === "N2O") bd_gas.n2o += s.valueMt;
                else bd_gas.other += s.valueMt;
            });

            yearObj.gas_bd[key] = bd_gas;
            // console.log(`Processed ${countryName} in ${year}: total=${yearObj[key]}, sector breakdown=`, bd, "gas breakdown=", bd_gas);
        });
        data.push(yearObj);
    });
    console.log("Prepared data for black hat chart:", data);

    const graphHeight = plotHeight - extraTopOffset;

    const graph_svg = svg.append("g")
        .attr('class', 'graph_layer')
        .attr("transform", `translate(0, ${extraTopOffset})`);

    // graph_svg.append("rect")
    //     .attr("width", plotWidth)
    //     .attr("height", graphHeight)
    //     .attr("fill", "none")
    //     .attr("stroke", "#333")
    //     .attr("stroke-width", 1);

    const x = d3.scaleLinear().domain([2005, 2022]).range([0, plotWidth]);
    const y = d3.scaleLog().domain([10, 15000]).range([graphHeight, 0]);

    graph_svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 0 - margin.left + 15)
        .attr("x", 0 - (graphHeight / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .style("font-family", "sans-serif")
        .style("font-weight", "bold")
        .style("font-size", "12px")
        .text("Emissions (MtCO₂e)*");

    // Hidden-in-plain-sight Footnote
    svg.append("text")
        .style("text-anchor", "start")
        .attr("x", 0)
        .attr("y", 540 )
        .style("font-family", "sans-serif")
        .style("font-size", "10px")
        .style("fill", "#888")
        .text("* Note: Plotted values utilize a logarithmic transformation.");

    const sectors = ["energy", "industrial", "agriculture", "waste", "other"];
    const ghgs = ["co2", "ch4", "n2o", "other"];

    const legend_box_width = 100; const legend_box_len = 130;

    sec_keys = [{sec_name: "energy", sec_color: "#e76f51"},
        {sec_name: "industrial", sec_color: "#f4a261"},
        {sec_name: "agriculture", sec_color: "#e9c46a"},
        {sec_name: "waste", sec_color: "#2a9d8f"},
        {sec_name: "other", sec_color: "#264653"}];

    gh_keys = [{sec_name: "CO2", sec_color: "#87a944"},
        {sec_name: "CH4", sec_color: "#44a6a9"},
        {sec_name: "N2O", sec_color: "rgb(202, 146, 159)"},
        {sec_name: "other", sec_color: "#cabc92"}];

    country_legend_data = [{country_name: "US", country_color: "#edffc2"},
        {country_name: "Russia", country_color: "#da8d8d"},
        {country_name: "Brazil", country_color: "#d86363"},
        {country_name: "Algeria", country_color: "#c33030"},
        {country_name: "Nepal", country_color: "#780000"}
    ]
    // Set legend
    let legend_data = null;
    let y_offset = 0;

    if (detail_type === 'sector') {
        legend_data = sec_keys;
    }else{
        legend_data = gh_keys;
        y_offset = 0;
    }

    const country_legend = svg.append('g')
        .attr('class', 'country-legend')
        .attr('transform', `translate(${plotWidth + 15}, 50)`);

    const country_legend_border = country_legend.append("g")
        .attr('class', 'country-legend-border-box');

    country_legend_border.append("rect")
        .attr("x", 0)
        .attr("y", 0 + y_offset+10)
        .attr("width", legend_box_width)
        .attr("height", legend_box_len)
        .attr("fill", "#dddddd")
        .attr("opacity", 0.5)
        .attr("stroke", "#343434")
        .attr("stroke-width", 2)
        .attr("stroke-opacity", 1);

    // Add one dot in the legend for each country
    // FIXED: Selecting by the precise class we are about to append
    country_legend.selectAll(".country-legend-rect")
        .data(country_legend_data)
        .enter()
        .append("rect")
            .attr("class", "country-legend-rect")
            .attr("x", 10)
            .attr("y", (d, i) => { return 20 + y_offset + i * 25; })
            .attr("width", 10)
            .attr("height", 10)
            .style("fill", (d) => { return d.country_color; });

    // Add text labels for each country
    // FIXED: Selecting by precise class and using "start" for text-anchor
    country_legend.selectAll(".country-legend-text")
        .data(country_legend_data)
        .enter()
        .append("text")
            .attr("class", "country-legend-text")
            .attr("x", 10 + 15)
            .attr("y", (d, i) => { return 25 + y_offset + i * 25; })
            .style("fill", (d) => { return d.country_color; })
            .text((d) => { return d.country_name; })
            .style("font-weight", "bold")
            .attr("text-anchor", "start")
            .style("font-size", "12px")
            .style("alignment-baseline", "middle");

    // Create Legends
    const legend = svg.append('g')
        .attr('class', 'legend')
        .attr('transform', `translate(${plotWidth+15}, ${200})`);

    const legend_border_box = legend.append("g")
        .attr('class', 'legend-border-box')

    legend_border_box.append("rect")
        .attr("x", 0)
        .attr("y", 0+y_offset)
        .attr("width", legend_box_width)
        .attr("height", legend_box_len)
        .attr("fill", "#dddddd")
        .attr("opacity", 0.5)
        .attr("stroke", "#343434")
        .attr("stroke-width", 2)
        .attr("stroke-opacity", 1);

    // Add one dot in the legend for each name.
    legend.selectAll("rects")
        .attr('class', 'legend-rects')
        .data(legend_data)
        .enter()
        .append("rect")
            .attr("x", 10)
            .attr("y", (d, i)=> { return 10+y_offset + i*25})
            .attr("width", 10)
            .attr("height", 10)
            .style("fill", (d)=> { return d.sec_color })

    legend.selectAll("text")
            .attr('class', 'legend-text')
            .data(legend_data)
            .enter()
            .append("text")
                .attr("x", 10+15)
                .style("font-size", "12px")
                .attr("y", (d, i)=> { return 15+y_offset + i*25})
                .style("fill", (d)=> { return d.sec_color })
                .text((d)=> { return d.sec_name })
                .style("font-weight", "bold")
                .attr("text-anchor", "left")
                .style("alignment-baseline", "middle")

    const createArea = (yTopKey, yBottomKey) => {
            return d3.area()
                .x(d => x(d.year))
                .y0(d => yBottomKey ? y(d[yBottomKey]) : y(10))
                .y1(d => {
                    // 'd' exists here because D3 is actively looping through your array
                    return y(d[yTopKey]); // You must explicitly return the final calculation
                });
        };

    const areas = [
        { name: "US", color: "#edffc2", key: "us", bottomKey: "russia" },
        { name: "Russia", color: "#da8d8d", key: "russia", bottomKey: "brazil" },
        { name: "Brazil", color: "#d86363", key: "brazil", bottomKey: "algeria" },
        { name: "Algeria", color: "#c33030", key: "algeria", bottomKey: "nepal" },
        { name: "Nepal", color: "#780000", key: "nepal", bottomKey: null }
    ];

    const sec_bds = {
        "us": { name: "US", bottomKey: "russia" },
        "russia": { name: "Russia", bottomKey: "brazil" },
        "brazil": { name: "Brazil", bottomKey: "algeria" },
        "algeria": { name: "Algeria", bottomKey: "nepal" },
        "nepal": { name: "Nepal", bottomKey: null }
    };

    Object.keys(sec_bds).forEach(key => {
        const c = sec_bds[key];

        const y0s = { energy: [], industrial: [], agriculture: [], waste: [], other: [] };
        const y1s = { energy: [], industrial: [], agriculture: [], waste: [], other: [] };

        data.forEach(d => {
            const bd = d.sector_bd[key];

            const bottomVal = c.bottomKey ? d[c.bottomKey] : 10;
            const span = d[key] - bottomVal;

            const totalBd = (bd.energy + bd.industrial + bd.agriculture + bd.waste + bd.other) || 1;

            let cumulativeBefore = 0;
            sectors.forEach(sector => {

                const fraction = bd[sector] / totalBd;
                const current_y0 = bottomVal + (span * cumulativeBefore);
                cumulativeBefore += fraction;
                const current_y1 = bottomVal + (span * cumulativeBefore);

                y0s[sector].push({ year: d.year, value: current_y0 });
                y1s[sector].push({ year: d.year, value: current_y1 });
            });
        });

        c.y0_data = y0s;
        c.y1_data = y1s;
    });


    const ghg_bds = {
        "us": { name: "US", bottomKey: "russia" },
        "russia": { name: "Russia", bottomKey: "brazil" },
        "brazil": { name: "Brazil", bottomKey: "algeria" },
        "algeria": { name: "Algeria", bottomKey: "nepal" },
        "nepal": { name: "Nepal", bottomKey: null }
    };

    Object.keys(ghg_bds).forEach(key => {
        const c = ghg_bds[key];

        const y0s = { co2: [], ch4: [], n2o: [], other: [] };
        const y1s = { co2: [], ch4: [], n2o: [], other: [] };

        data.forEach(d => {
            const bd = d.gas_bd[key];

            const bottomVal = c.bottomKey ? d[c.bottomKey] : 10;
            const span = d[key] - bottomVal;

            const totalBd = (bd.co2 + bd.ch4 + bd.n2o + bd.other) || 1;

            let cumulativeBefore = 0;
            ghgs.forEach(ghg => {
                const fraction = bd[ghg] / totalBd;
                const current_y0 = bottomVal + (span * cumulativeBefore);
                cumulativeBefore += fraction;
                const current_y1 = bottomVal + (span * cumulativeBefore);

                y0s[ghg].push({ year: d.year, value: current_y0 });
                y1s[ghg].push({ year: d.year, value: current_y1 });
            });
        });

        c.y0_data = y0s;
        c.y1_data = y1s;
    });

    selected_country = null;

    const createAreaBd_sec = (countryKey, sectorName, mapping) => {
        return d3.area()
            .x((d, i) => x(mapping[countryKey].y0_data[sectorName][i].year))
            .y0((d, i) => y(mapping[countryKey].y0_data[sectorName][i].value))
            .y1((d, i) => y(mapping[countryKey].y1_data[sectorName][i].value));
    };

    // Make sure this is declared somewhere above your click event!
    const sectorColors = ["#e76f51", "#f4a261", "#e9c46a", "#2a9d8f", "#264653"];
    const ghg_colors = ["#87a944", "#44a6a9", "rgb(202, 146, 159)", "#cabc92"];
    let category_name = '';
    if (detail_type === "ghg"){
        cat_arr = ghgs;
        color_mapping = ghg_colors;
        mapping = ghg_bds;
        category_name = 'Greenhouse gas'
    }else{
        cat_arr = sectors;
        color_mapping = sectorColors;
        mapping = sec_bds
        category_name = 'Sectors'
    }

    areas.forEach(country => {
        // Create a group for each country to keep the DOM organized
        const countryGroup = graph_svg.append("g").attr("class", `country-g-${country.key}`);

        cat_arr.forEach((sector, i) => {
            countryGroup.append("path")
                .datum(data)
                .attr("class", `sector-path path-${country.key} sector-${sector}`)
                .attr("fill", country.color)
                .attr("stroke", country.color)
                .attr("stroke-width", "0.5px")
                .attr("stroke-opacity", 0.8)
                .attr("fill", country.color)
                .attr("d", createAreaBd_sec(country.key, sector, mapping)(data))

                .on("click", function(event) {
                    event.stopPropagation();
                    if (selected_country === country.key) {
                        // --- RESET MODE ---
                        y.domain([10, 15000]);
                        selected_country = null;
                        hideTooltip()
                        graph_svg.selectAll(".year-trackers").remove();

                        graph_svg.selectAll(".country-text").remove();

                        graph_svg.selectAll(".country-border")
                            .transition().duration(750)
                            .attr("opacity", 0)
                            .remove();

                        areas.forEach(c => {
                            cat_arr.forEach(s => {
                                graph_svg.select(`.path-${c.key}.sector-${s}`)
                                    .transition().duration(750)
                                    .attr("opacity", 1)
                                    .attr("fill", c.color)
                                    .attr("stroke", c.color)
                                    .attr("stroke-opacity", 1)
                                    .style("stroke-width", "0.5px")
                                    .attr("d", createAreaBd_sec(c.key, s, mapping)(data));

                            });
                        });

                        yAxis.transition().duration(750)
                            .attr("class", "yaxis")
                            .call(
                                d3.axisLeft(y)
                                .tickValues(customTicks)
                                .tickFormat(d => {
                                    if (d === 15000) {
                                        return d3.format("~s")(d);
                                    }
                                    return "";
                            }));

                    } else {
                        const yUpper = d3.max(data, d => d[country.key]);
                        y.domain([10, yUpper * 1.1]);
                        selected_country = country.key;

                        graph_svg.selectAll(".country-border").remove();

                        const selected_area = graph_svg.append("path")
                            .datum(data)
                            .attr("class", "country-border")
                            .attr("fill", "none")
                            .attr("stroke", "#333")
                            .attr("stroke-width", "1px")
                            .attr("d", createArea(country.key, country.bottomKey))
                            .attr("opacity", 0)
                            // .on("mousemove", (event, d) => {
                            //     html_content = `
                            //         <br>Year: ${d.year}<br>
                            //         ${cat_arr.map( eachCat => {
                            //             const cat_value = d[country.key][eachCat];
                            //             return (`${eachCat}: ${cat_value}%<br>`);
                            //         }).join("")}
                            //         `;
                            //     console.log("Tooltip content for country border:", html_content);
                            //     showTooltip(event, html_content);
                            // })
                            // .on("mouseleave", hideTooltip)
                            .transition().duration(750)
                            .attr("opacity", 1);

                            const interactionGroup = graph_svg.append("g").attr("class", "year-trackers");

                            const sliceWidth = plotWidth / data.length;

                            interactionGroup.selectAll(".year-slice")
                                .data(data)
                                .enter()
                                .append("rect")
                                .attr("class", "year-slice")

                                .attr("x", d => x(d.year) - (sliceWidth / 2))
                                .attr("y", 0)
                                .attr("width", sliceWidth)
                                .attr("height", graphHeight)

                                .attr("fill", "transparent")
                                .style("pointer-events", "all")
                                .on("mousemove", (event, d) => {
                                    if (!selected_country) {
                                        hideTooltip();
                                        return;
                                    }

                                const targetData = (detail_type === "ghg") ? d.gas_bd[country.key] : d.sector_bd[country.key];

                                if (!targetData) return;

                                const total = targetData.sum || 1;

                                const html_content = `
                                    <div style="font-weight: bold; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 4px;">
                                        ${d.year} ${category_name} Breakdown
                                    </div>
                                    ${cat_arr.map(eachCat => {
                                        // Read the value directly from our pre-selected target
                                        const cat_value = targetData[eachCat] || 0;
                                        const percentage = (cat_value / total) * 100;

                                        // Capitalize the label for a clean, professional UI
                                        const displayLabel = eachCat.charAt(0).toUpperCase() + eachCat.slice(1);

                                        return `<div>${displayLabel}: ${d3.format(",.1f")(percentage)}%  (${formatMt(cat_value)})</div>`;
                                    }).join("")}
                                `;
                                    showTooltip(event, html_content);
                                })
                                .on("mouseleave", hideTooltip)

                                .on("click", function(event) {
                                    if (selected_country) {
                                        const targetNode = graph_svg.select(`.path-${selected_country}`).node();
                                        if (targetNode) targetNode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                                    }
                                });

                        areas.forEach(c => {
                            const isSelected = (c.key === selected_country);
                            const targetOpacity = isSelected ? 1 : 0.15; // Determine opacity here

                            cat_arr.forEach((s, j) => {
                                const targetColor = isSelected ? color_mapping[j] : c.color;

                                graph_svg.select(`.path-${c.key}.sector-${s}`)
                                    .transition().duration(750)
                                    .attr("opacity", targetOpacity)
                                    .attr("fill", targetColor)
                                    .attr("stroke", targetColor)
                                    .attr("stroke-opacity", targetOpacity)
                                    .attr("d", createAreaBd_sec(c.key, s, mapping)(data));
                            });
                        });
                        const countryText = graph_svg.append("text")
                            .datum(data)
                            .attr("class", "country-text")
                            .attr("x", 10) // Position it towards the right
                            .attr("y", y(data[0][country.bottomKey] ? data[0][country.bottomKey] : 10) - 10)
                            .attr("opacity", 1)
                            .attr("fill", "#f3fbff")
                            .text(country.name)
                            .style("font-weight", "bold")
                            .attr("text-anchor", "left")
                            .style("alignment-baseline", "left")

                        yAxis.transition().duration(750).call(d3.axisLeft(y).tickValues([]));
                    }
            });
        });
    });

    const customTicks = [15, 50, 150, 500, 1500, 5000, 15000];

    const yAxis = graph_svg.append("g")
        .attr("class", "yaxis")
        .call(
            d3.axisLeft(y)
            .tickValues(customTicks)
            .tickFormat(d => {
                if (d === 15000) {
                    return d3.format("~s")(d);
                }
                return "";
            })
    );

    const xAxis = graph_svg.append("g")
                .attr("transform", `translate(0,${graphHeight})`)
                .call(d3.axisBottom(x).tickFormat(d3.format("d")))
                .attr("class", "xaxis");

    const line = d3.line().x(d => x(d.year)).y(d => y(d.value)); // Uses true log scale

    ["us", "russia", "brazil", "algeria", "nepal"].forEach(key => {
        const lineData = data.map(d => ({ year: d.year, value: d[key] }));
        svg.append("path")
            .datum(lineData)
            .attr("fill", "none")
            .attr("stroke", "#a2a2a200")
            .attr("stroke-width", 1.5)
            .attr("d", line);
    });
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