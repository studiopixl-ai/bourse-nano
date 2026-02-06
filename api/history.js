import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const KEY_HISTORY = 'nano_portfolio_history';
  const KEY_DATA = 'nano_portfolio_v2';

  // GET: Récupérer l'historique
  if (req.method === 'GET') {
    // Récupérer tout l'historique (trié par date si possible, mais ici c'est une liste simple)
    // On stocke sous forme de liste JSON : [ { date: '2026-02-06', value: 245000, invested: 235000 }, ... ]
    const history = await redis.get(KEY_HISTORY) || [];
    return res.status(200).json(history);
  }

  // POST: Créer un snapshot (appelé par Cron ou Manuellement)
  if (req.method === 'POST') {
    // 1. Récupérer la compo actuelle
    const data = await redis.get(KEY_DATA);
    if (!data) return res.status(500).json({ error: 'No data' });

    // 2. Calculer la valorisation LIVE
    // On doit refaire les appels Yahoo pour avoir le prix de clôture exact
    // Pour simplifier le script de snapshot, on va appeler l'API stocks en interne ou refaire la logique.
    // Ici, on va faire simple : on suppose que le Cron appelle une URL qui fait le calcul.
    // Mieux : on réutilise la logique de valorisation.
    
    // Pour éviter de dupliquer le code complexe de Yahoo ici, on va faire un fetch sur notre propre API stocks si possible,
    // ou réimporter la logique. Vercel permet d'appeler ses propres fonctions serverless.
    
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const stocksUrl = `${protocol}://${host}/api/stocks`;
    
    try {
        const stocksRes = await fetch(stocksUrl);
        const stocksData = await stocksRes.json();
        
        if (!stocksData.lines) throw new Error("Failed to fetch stocks");

        let totalValue = 0;
        let totalInvested = 0;

        // Calcul total
        stocksData.lines.forEach(l => {
            if (!l.error) totalValue += l.totalValue;
        });

        // Calcul investi
        Object.values(stocksData.accounts).forEach(acc => {
            totalInvested += (acc.initial || 0);
        });

        // Date du jour YYYY-MM-DD
        const today = new Date().toISOString().split('T')[0];

        // 3. Sauvegarder
        let history = await redis.get(KEY_HISTORY) || [];
        
        // Vérifier si on a déjà une entrée pour aujourd'hui, si oui on l'écrase (mise à jour)
        const index = history.findIndex(h => h.date === today);
        const entry = { date: today, value: totalValue, invested: totalInvested };
        
        if (index >= 0) {
            history[index] = entry;
        } else {
            history.push(entry);
        }

        // Garder seulement les 365 derniers jours pour ne pas exploser Redis (optionnel)
        if (history.length > 365) history = history.slice(-365);

        await redis.set(KEY_HISTORY, history);

        return res.status(200).json({ status: 'Snapshot saved', entry });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
  }
}
