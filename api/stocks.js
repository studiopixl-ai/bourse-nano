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
        // Pour les perfs historiques, on a besoin du chart
        const responseChart = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2y`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        
        // Pour le Jour, on prend le Quote (plus fiable pour le % jour)
        // Mais comme l'endpoint Quote est parfois bloqué, on va essayer d'extraire la donnée fiable du chart META
        // Si le chart donne un prevClose délirant, on le verra.
        
        if (!responseChart.ok) throw new Error("Fetch failed");
        const json = await responseChart.json();
        const result = json.chart.result[0];
        const meta = result.meta;
        const quotes = result.indicators.quote[0].close;
        const timestamps = result.timestamp;
        
        const cleanHistory = [];
        for(let i=0; i<quotes.length; i++) {
            if(quotes[i] !== null && quotes[i] !== undefined) {
                cleanHistory.push({ date: new Date(timestamps[i]*1000), price: quotes[i] });
            }
        }
        
        const currentPrice = meta.regularMarketPrice;
        
        // CORRECTION : On utilise le prevClose META s'il semble cohérent, sinon on prend le dernier point historique
        let prevClose = meta.chartPreviousClose;
        if (!prevClose || prevClose < 1) prevClose = cleanHistory[cleanHistory.length - 2]?.price || currentPrice;

        const dayChange = ((currentPrice - prevClose) / prevClose) * 100;

        const getPerf = (daysBack) => {
            if (cleanHistory.length <= daysBack) return 0;
            const refPrice = cleanHistory[cleanHistory.length - 1 - daysBack].price;
            return ((currentPrice - refPrice) / refPrice) * 100;
        };

        let ytdChange = 0;
        const currentYear = new Date().getFullYear();
        const firstQuoteOfYear = cleanHistory.find(h => h.date.getFullYear() === currentYear);
        if (firstQuoteOfYear) {
            const lastYearIndex = cleanHistory.findIndex(h => h.date.getFullYear() === currentYear) - 1;
            let refPriceYtd = firstQuoteOfYear.price;
            if (lastYearIndex >= 0) refPriceYtd = cleanHistory[lastYearIndex].price;
            ytdChange = ((currentPrice - refPriceYtd) / refPriceYtd) * 100;
        }

        let priceInEur = currentPrice;
        if (meta.currency === 'USD') priceInEur = currentPrice / eurUsdRate;

        pricesMap[symbol] = {
          name: meta.shortName || meta.symbol,
          price: currentPrice,
          priceInEur: priceInEur,
          change: dayChange,
          perf1w: getPerf(5),
          perf1m: getPerf(20),
          perf1y: getPerf(250),
          perfYtd: ytdChange,
          currency: meta.currency,
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
      let gainPercent = 0;
      if (item.pru > 0) {
        gain = (marketData.priceInEur - item.pru) * item.quantity;
        gainPercent = ((marketData.priceInEur - item.pru) / item.pru) * 100;
      }

      return { ...item, ...marketData, totalValue, gain, gainPercent };
    });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json({ lines: enrichedLines, accounts: data.accounts, forex: eurUsdRate });
  } catch (error) {
    res.status(500).json({ error: 'Erreur globale', details: error.message });
  }
}
