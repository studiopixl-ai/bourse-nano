export default async function handler(req, res) {
  const { Redis } = await import('@upstash/redis');
  const redis = Redis.fromEnv();

  try {
    const portfolio = await redis.get('nano_portfolio') || [];

    // Récupérer le taux de change EURUSD en temps réel
    let eurUsdRate = 1.04; // Fallback
    try {
      const forexRes = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1d&range=1d", {
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      const forexJson = await forexRes.json();
      eurUsdRate = forexJson.chart.result[0].meta.regularMarketPrice;
    } catch (e) { console.error("Forex error", e); }

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

        // Gestion Devise
        let priceInEur = price;
        const isUsd = meta.currency === 'USD';
        
        if (isUsd) {
          // Si le titre est en USD (ex: OCS), on le convertit en EUR pour le calcul de gain
          // Prix ($) / Taux (EURUSD) = Prix (€)
          priceInEur = price / eurUsdRate; 
        }

        // Calculs Financiers (Tout en EUR)
        const totalValue = priceInEur * item.quantity;
        let gain = 0;
        let gainPercent = 0;

        if (item.pru > 0) {
          // Gain = (Prix Actuel € - PRU €) * Quantité
          gain = (priceInEur - item.pru) * item.quantity;
          gainPercent = ((priceInEur - item.pru) / item.pru) * 100;
        }

        return {
          symbol: item.symbol,
          quantity: item.quantity,
          pru: item.pru,
          name: meta.shortName || meta.symbol,
          price: price, // On garde le prix original pour l'affichage
          priceInEur: priceInEur,
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
    res.status(200).json({ stocks: results, forex: eurUsdRate });
  } catch (error) {
    res.status(500).json({ error: 'Erreur globale', details: error.message });
  }
}
