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

    // On regroupe les symboles pour ne pas appeler Yahoo 50 fois si on a le même titre sur 3 comptes
    const uniqueSymbols = [...new Set(portfolio.map(p => p.symbol))];
    const pricesMap = {};

    await Promise.all(uniqueSymbols.map(async (symbol) => {
      try {
        const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1mo`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        if (!response.ok) throw new Error("Fetch failed");
        const json = await response.json();
        const result = json.chart.result[0];
        const meta = result.meta;
        const quotes = result.indicators.quote[0].close;

        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose;
        const change = ((price - prevClose) / prevClose) * 100;
        
        let priceInEur = price;
        if (meta.currency === 'USD') priceInEur = price / eurUsdRate;

        pricesMap[symbol] = {
          name: meta.shortName || meta.symbol,
          price: price,
          priceInEur: priceInEur,
          change: change,
          currency: meta.currency,
          history: quotes.filter(q => q !== null)
        };
      } catch (e) {
        pricesMap[symbol] = { error: true };
      }
    }));

    // On enrichit les lignes
    const enrichedLines = portfolio.map(item => {
      const marketData = pricesMap[item.symbol] || { error: true };
      if (marketData.error) return { ...item, error: true };

      const totalValue = marketData.priceInEur * item.quantity;
      let gain = 0;
      
      // Gain latent sur la ligne
      if (item.pru > 0) gain = (marketData.priceInEur - item.pru) * item.quantity;

      return {
        ...item,
        ...marketData,
        totalValue,
        gain
      };
    });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json({ lines: enrichedLines, accounts: data.accounts, forex: eurUsdRate });
  } catch (error) {
    res.status(500).json({ error: 'Erreur globale', details: error.message });
  }
}
