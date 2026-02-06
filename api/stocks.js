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
        // On demande 1 AN d'historique pour calculer les perfs
        const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        if (!response.ok) throw new Error("Fetch failed");
        const json = await response.json();
        const result = json.chart.result[0];
        const meta = result.meta;
        const quotes = result.indicators.quote[0].close;
        const timestamps = result.timestamp;

        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose;
        const dayChange = ((price - prevClose) / prevClose) * 100;
        
        // Calcul des variations historiques (en trouvant l'index correct)
        const getVariation = (daysAgo) => {
          if (quotes.length < daysAgo) return 0;
          const oldPrice = quotes[quotes.length - 1 - daysAgo];
          if (!oldPrice) return 0;
          return ((price - oldPrice) / oldPrice) * 100;
        };

        // Calcul YTD (1er Janvier)
        let ytdChange = 0;
        const currentYear = new Date().getFullYear();
        // On cherche le premier index de l'année
        const startOfYearIndex = timestamps.findIndex(ts => new Date(ts * 1000).getFullYear() === currentYear);
        if (startOfYearIndex !== -1 && quotes[startOfYearIndex]) {
           ytdChange = ((price - quotes[startOfYearIndex]) / quotes[startOfYearIndex]) * 100;
        }

        let priceInEur = price;
        if (meta.currency === 'USD') priceInEur = price / eurUsdRate;

        pricesMap[symbol] = {
          name: meta.shortName || meta.symbol,
          price: price,
          priceInEur: priceInEur,
          change: dayChange, // Jour
          perf1w: getVariation(5),  // 1 Semaine (~5 jours de bourse)
          perf1m: getVariation(21), // 1 Mois (~21 jours de bourse)
          perf1y: getVariation(250),// 1 An (~250 jours de bourse)
          perfYtd: ytdChange,       // Depuis le 1er Janvier
          currency: meta.currency,
          // Pour le sparkline, on garde les 30 derniers jours pour que ce soit lisible
          history: quotes.slice(-30).filter(q => q !== null)
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
