export default async function handler(req, res) {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();

  try {
    const data = await redis.get('nano_portfolio_v2') || { lines: [], accounts: {} };
    const portfolio = data.lines;

    // Forex
    let eurUsdRate = 1.04;
    try {
      const forexRes = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1d&range=1d", { headers: { "User-Agent": "Mozilla/5.0" } });
      const forexJson = await forexRes.json();
      eurUsdRate = forexJson.chart.result[0].meta.regularMarketPrice;
    } catch (e) {}

    const uniqueSymbols = [...new Set(portfolio.map(p => p.symbol))];
    const pricesMap = {};

    await Promise.all(uniqueSymbols.map(async (symbol) => {
      try {
        // On demande 2 ans pour être large et avoir le YTD même en janvier
        const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2y`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        if (!response.ok) throw new Error("Fetch failed");
        const json = await response.json();
        const result = json.chart.result[0];
        const meta = result.meta;
        // Filtrer les nulls (jours fériés sans data)
        const quotes = result.indicators.quote[0].close;
        const timestamps = result.timestamp;
        
        // On nettoie les données (parfois Yahoo a des trous)
        const cleanHistory = [];
        for(let i=0; i<quotes.length; i++) {
            if(quotes[i] !== null && quotes[i] !== undefined) {
                cleanHistory.push({ date: new Date(timestamps[i]*1000), price: quotes[i] });
            }
        }
        
        const currentPrice = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose;
        const dayChange = ((currentPrice - prevClose) / prevClose) * 100;

        // Fonction helper variation
        const getPerf = (daysBack) => {
            if (cleanHistory.length <= daysBack) return 0;
            // On prend le prix à l'index (Fin - 1 - Jours)
            const refPrice = cleanHistory[cleanHistory.length - 1 - daysBack].price;
            return ((currentPrice - refPrice) / refPrice) * 100;
        };

        // Calcul YTD Précis (Premier jour coté de l'année en cours)
        let ytdChange = 0;
        const currentYear = new Date().getFullYear();
        const firstQuoteOfYear = cleanHistory.find(h => h.date.getFullYear() === currentYear);
        if (firstQuoteOfYear) {
            // Variation par rapport à la CLÔTURE de l'année d'avant (ou ouverture premier jour)
            // Convention standard YTD : (Prix Actuel - Clôture Dernier jour année N-1) / Clôture N-1
            // Si on ne l'a pas, on prend l'ouverture du premier jour.
            
            // On cherche le dernier jour de l'année d'avant
            const lastYearIndex = cleanHistory.findIndex(h => h.date.getFullYear() === currentYear) - 1;
            let refPriceYtd = firstQuoteOfYear.price; // Fallback
            
            if (lastYearIndex >= 0) {
                refPriceYtd = cleanHistory[lastYearIndex].price;
            }
            ytdChange = ((currentPrice - refPriceYtd) / refPriceYtd) * 100;
        }

        let priceInEur = currentPrice;
        if (meta.currency === 'USD') priceInEur = currentPrice / eurUsdRate;

        pricesMap[symbol] = {
          name: meta.shortName || meta.symbol,
          price: currentPrice,
          priceInEur: priceInEur,
          change: dayChange,
          // Jours de Bourse (Trading Days) :
          perf1w: getPerf(5),   // 5 séances = 1 semaine
          perf1m: getPerf(20),  // 20 séances = 1 mois
          perf1y: getPerf(250), // 250 séances = 1 an
          perfYtd: ytdChange,
          currency: meta.currency,
          // Pour le sparkline (30 derniers points)
          history: cleanHistory.slice(-30).map(h => h.price)
        };
      } catch (e) {
        pricesMap[symbol] = { error: true };
      }
    }));

    const enrichedLines = portfolio.map(item => {
      const marketData = pricesMap[item.symbol] || { error: true };
      if (marketData.error) return { ...item, error: true };

      const totalValue = marketData.priceInEur * item.quantity;
      let gain = 0;
      if (item.pru > 0) gain = (marketData.priceInEur - item.pru) * item.quantity;

      return { ...item, ...marketData, totalValue, gain };
    });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json({ lines: enrichedLines, accounts: data.accounts, forex: eurUsdRate });
  } catch (error) {
    res.status(500).json({ error: 'Erreur globale', details: error.message });
  }
}
