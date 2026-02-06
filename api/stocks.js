export default async function handler(req, res) {
  const symbols = ['OCS', 'MEDCL.PA', 'ALCOX.PA', 'ALCJ.PA'];

  try {
    const promises = symbols.map(async (symbol) => {
      try {
        // On utilise l'endpoint 'quote' qui donne le % par rapport à la clôture veille
        const response = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`);
        if (!response.ok) throw new Error("Fetch failed");
        
        const json = await response.json();
        const result = json.quoteResponse.result[0];

        return {
          symbol: symbol,
          name: result.shortName || result.longName || symbol,
          price: result.regularMarketPrice,
          change: result.regularMarketChangePercent, // C'est le % "Day Change" officiel
          currency: result.currency
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
