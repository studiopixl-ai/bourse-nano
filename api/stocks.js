import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  try {
    // 1. Récupérer la liste depuis Redis
    const portfolio = await redis.get('nano_portfolio');
    
    // Si vide ou pas encore créé, on met une liste par défaut pour commencer
    const symbolsData = portfolio || [
      { symbol: 'OCS', quantity: 0 },
      { symbol: 'MEDCL.PA', quantity: 0 },
      { symbol: 'ALCOX.PA', quantity: 0 },
      { symbol: 'ALCJ.PA', quantity: 0 }
    ];

    // 2. Chercher les prix
    const promises = symbolsData.map(async (item) => {
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

        return {
          symbol: item.symbol,
          quantity: item.quantity,
          name: meta.shortName || meta.symbol,
          price: price,
          change: change,
          currency: meta.currency,
          value: price * item.quantity // Valorisation
        };
      } catch (err) {
        console.error(`Error fetching ${item.symbol}:`, err);
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
