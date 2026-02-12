const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.2.1",
    name: "SKTonline - Fix Search",
    description: "Oprava vyhľadávania - simulácia formulára",
    types: ["movie", "series"],
    catalogs: [],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

// Maximálna simulácia prehliadača
const getFullHeaders = (query = "") => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'sk-SK,sk;q=0.9,cs;q=0.8,en-US;q=0.7,en;q=0.6',
    'Cache-Control': 'max-age=0',
    'Referer': query ? `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}` : 'https://online.sktorrent.eu/',
    'Upgrade-Insecure-Requests': '1'
});

async function getIMDbName(id) {
    try {
        const res = await axios.get(`https://www.imdb.com/title/${id}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(res.data);
        return $('title').text().split(' (')[0].trim();
    } catch (e) { return null; }
}

builder.defineStreamHandler(async ({ id }) => {
    const movieName = await getIMDbName(id.split(":")[0]);
    if (!movieName) return { streams: [] };

    // Hľadáme bez diakritiky (Gladiátor -> Gladiator)
    const cleanQuery = movieName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(cleanQuery)}`;

    try {
        console.log(`[SEARCH] 🔍 Hľadám: ${cleanQuery}`);
        
        // 1. Krok: Získanie výsledkov vyhľadávania
        const response = await axios.get(searchUrl, { headers: getFullHeaders(cleanQuery) });
        const $ = cheerio.load(response.data);
        const results = [];

        // Selektor upravený na presnú štruktúru webu
        $('a[href*="/video/"]').each((i, el) => {
            const href = $(el).attr('href');
            const title = $(el).text().trim() || $(el).attr('title');
            if (href && title && title.length > 2) {
                const vidId = href.split('/').pop();
                if (!results.find(r => r.id === vidId)) results.push({ id: vidId, title: title });
            }
        });

        console.log(`[FOUND] Počet videí: ${results.length}`);

        let streams = [];
        // 2. Krok: Extrakcia streamov z prvých nájdených videí
        for (const video of results.slice(0, 3)) {
            const vPage = await axios.get(`https://online.sktorrent.eu/video/${video.id}`, { headers: getFullHeaders(cleanQuery) });
            const $v = cheerio.load(vPage.data);

            // Hľadanie zdroja videa (všetky možné tagy)
            $v('source, video source').each((i, el) => {
                const src = $v(el).attr('src');
                const label = $v(el).attr('label') || $v(el).attr('res') || 'HD';
                if (src) {
                    streams.push({
                        name: `SKTonline\n${label}`,
                        title: video.title,
                        url: src.startsWith('http') ? src : `https://online.sktorrent.eu${src}`
                    });
                }
            });

            // Download linky ako alternatíva
            $v('a[href*="get_video"]').each((i, el) => {
                const dLink = $v(el).attr('href');
                if (dLink) {
                    streams.push({
                        name: `SKTonline\n📥 MP4`,
                        title: video.title,
                        url: dLink.startsWith('http') ? dLink : `https://online.sktorrent.eu${dLink}`
                    });
                }
            });
        }

        // Odstránenie duplikátov
        const uniqueStreams = streams.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
        console.log(`[DONE] Odosielam ${uniqueStreams.length} streamov.`);
        return { streams: uniqueStreams };

    } catch (error) {
        console.log(`[ERR] ${error.message}`);
        return { streams: [] };
    }
});

const port = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port });
