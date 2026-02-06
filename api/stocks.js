import yahooFinance from 'yahoo-finance2';

export default async function handler(req, res) {
  // Les tickers exacts (Attention, ALCOX pour Nicox !)
  const symbols = ['OCS', 'MEDCL.PA', 'ALCOX.PA', 'ALCJ.PA'];

  try {
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const quote = await yahooFinance.quote(symbol);
          return {
            symbol: symbol,
            name: quote.shortName || quote.longName,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChangePercent,
            currency: quote.currency,
            marketState: quote.marketState
          };
        } catch (err) {
          return { symbol, error: "Donnée indisponible" };
        }
      })
    );

    // Cache pour 1 minute pour ne pas spammer Yahoo
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
}
