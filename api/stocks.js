export default async function handler(req, res) {
  const symbols = ['OCS', 'MEDCL.PA', 'ALCOX.PA', 'ALCJ.PA'];

  try {
    // RETOUR À LA VERSION CHART (V8) QUI PASSAIT LE FIREWALL
    const promises = symbols.map(async (symbol) => {
      try {
        const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`, {
          headers: {
            "User-Agent": "Mozilla/5.0" // On garde le user-agent au cas où
          }
        });
        
        if (!response.ok) throw new Error("Fetch failed");
        
        const json = await response.json();
        const result = json.chart.result[0];
        const meta = result.meta;
        
        // CALCUL PRÉCIS (Day Change)
        // regularMarketPrice = Prix actuel
        // chartPreviousClose = Clôture de la veille (C'est ça qu'on veut !)
        
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose;
        const change = ((price - prevClose) / prevClose) * 100;

        return {
          symbol: symbol,
          name: meta.shortName || meta.symbol,
          price: price,
          change: change, // Le vrai % jour
          currency: meta.currency
        };
      } catch (err) {
        console.error(`Error fetching ${symbol}:`, err);
        return { symbol, error: "Indisponible" };
      }
    });

    const results = await Promise.all(promises);
    
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: 'Erreur globale', details: error.message });
  }
}
