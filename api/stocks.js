export default async function handler(req, res) {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();

  try {
    const portfolio = await redis.get('nano_portfolio') || [];

    // Forex
    let eurUsdRate = 1.04;
    try {
      const forexRes = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1d&range=1d", { headers: { "User-Agent": "Mozilla/5.0" } });
      const forexJson = await forexRes.json();
      eurUsdRate = forexJson.chart.result[0].meta.regularMarketPrice;
    } catch (e) {}

    const promises = portfolio.map(async (item) => {
      try {
        // On demande 30 jours pour avoir un beau mini-graphe
        const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${item.symbol}?interval=1d&range=1mo`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        
        if (!response.ok) throw new Error("Fetch failed");
        
        const json = await response.json();
        const result = json.chart.result[0];
        const meta = result.meta;
        const quotes = result.indicators.quote[0].close; // Historique des prix
        
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose;
        const change = ((price - prevClose) / prevClose) * 100;

        let priceInEur = price;
        if (meta.currency === 'USD') priceInEur = price / eurUsdRate;

        const totalValue = priceInEur * item.quantity;
        let gain = 0;
        let gainPercent = 0;

        if (item.pru > 0) {
          gain = (priceInEur - item.pru) * item.quantity;
          gainPercent = ((priceInEur - item.pru) / item.pru) * 100;
        }

        return {
          symbol: item.symbol,
          quantity: item.quantity,
          pru: item.pru,
          name: meta.shortName || meta.symbol,
          price: price,
          dayChange: change,
          currency: meta.currency,
          totalValue: totalValue,
          gain: gain,
          gainPercent: gainPercent,
          history: quotes.filter(q => q !== null) // On renvoie l'historique nettoyé
        };
      } catch (err) {
        return { symbol: item.symbol, error: "Indisponible", quantity: item.quantity };
      }
    });

    const results = await Promise.all(promises);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json({ stocks: results, forex: eurUsdRate });
  } catch (error) {
    res.status(500).json({ error: 'Erreur globale', details: error.message });
  }
}
