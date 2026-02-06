export default async function handler(req, res) {
  // On importe Redis aussi ici pour lire le PRU
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();

  try {
    const portfolio = await redis.get('nano_portfolio') || [];

    const promises = portfolio.map(async (item) => {
      try {
        const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${item.symbol}?interval=1d&range=5d`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        
        if (!response.ok) throw new Error("Fetch failed");
        
        const json = await response.json();
        const result = json.chart.result[0];
        const meta = result.meta;
        
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose;
        const change = ((price - prevClose) / prevClose) * 100;

        // Calculs Financiers
        const totalValue = price * item.quantity;
        let gain = 0;
        let gainPercent = 0;

        if (item.pru > 0) {
          gain = (price - item.pru) * item.quantity;
          gainPercent = ((price - item.pru) / item.pru) * 100;
        }

        return {
          symbol: item.symbol,
          quantity: item.quantity,
          pru: item.pru, // On renvoie le PRU
          name: meta.shortName || meta.symbol,
          price: price,
          dayChange: change,
          currency: meta.currency,
          totalValue: totalValue,
          gain: gain,
          gainPercent: gainPercent
        };
      } catch (err) {
        return { symbol: item.symbol, error: "Indisponible", quantity: item.quantity };
      }
    });

    const results = await Promise.all(promises);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: 'Erreur globale', details: error.message });
  }
}
