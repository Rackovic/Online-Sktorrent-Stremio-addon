const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const builder = addonBuilder({
    id: "org.stremio.sktonline",
    version: "1.2.0",
    name: "SKTonline - Priame hľadanie",
    description: "Prepojené priamo s vyhľadávacím oknom online.sktorrent.eu",
    types: ["movie", "series"],
    catalogs: [],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

// Tento objekt simuluje správanie skutočného prehliadača
const browserConfig = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'sk-SK,sk;q=0.9,cs;q=0.8,en;q=0.7',
        'Referer': 'https://online.sktorrent.eu/',
        'Origin': 'https://online.sktorrent.eu',
        'Connection': 'keep-alive'
    },
    timeout: 7000
};

// Funkcia na získanie názvu filmu z IMDb (pre Stremio)
async function getIMDbName(id) {
    try {
        const res = await axios.get(`https://www.imdb.com/title/${id}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(res.data);
        const fullTitle = $('title').text();
        return fullTitle.split(' (')[0].trim();
    } catch (e) { return null; }
}

builder.defineStreamHandler(async ({ id }) => {
    const imdbId = id.split(":")[0];
    const movieName = await getIMDbName(imdbId);
    
    if (!movieName) return { streams: [] };

    console.log(`[STREMIO] Požiadavka na: ${movieName}`);

    // Simulujeme zadanie do vyhľadávacieho okna na webe
    // Odstraňujeme diakritiku, lebo vyhľadávanie na SKTorrent je na ňu náchylné
    const query = movieName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(query)}`;

    try {
        const response = await axios.get(searchUrl, browserConfig);
        const $ = cheerio.load(response.data);
        const results = [];

        // Prepojenie s výsledkami vyhľadávania na stránke
        // Hľadáme linky, ktoré vedú na videá
        $('a[href*="/video/"]').each((i, el) => {
            const href = $(el).attr('href');
            const title = $(el).text().trim() || $(el).attr('title');
            
            if (href && title && title.length > 3) {
                const videoId = href.split('/').pop();
                if (!results.find(r => r.id === videoId)) {
                    results.push({ id: videoId, title: title });
                }
            }
        });

        console.log(`[WEB] Našiel som ${results.length} videí pre dotaz "${query}"`);

        let streams = [];
        // Otvoríme prvé dva výsledky z vyhľadávania a vytiahneme z nich prehrávač
        for (const video of results.slice(0, 2)) {
            const videoPage = await axios.get(`https://online.sktorrent.eu/video/${video.id}`, browserConfig);
            const $v = cheerio.load(videoPage.data);

            // Extrakcia MP4 linkov z prehrávača (to, čo vidíš v okne na webe)
            $v('video source, source').each((i, el) => {
                const src = $v(el).attr('src');
                const label = $v(el).attr('label') || $v(el).attr('res') || 'Kvalita';
                if (src) {
                    streams.push({
                        name: `SKTonline\n${label}`,
                        title: video.title,
                        url: src.startsWith('http') ? src : `https://online.sktorrent.eu${src}`
                    });
                }
            });

            // Extrakcia tlačidiel na stiahnutie (Download)
            $v('a[href*="get_video"]').each((i, el) => {
                const href = $v(el).attr('href');
                if (href) {
                    streams.push({
                        name: `SKTonline\n📥 Súbor`,
                        title: video.title,
                        url: href.startsWith('http') ? href : `https://online.sktorrent.eu${href}`
                    });
                }
            });
        }

        return { streams: streams };

    } catch (error) {
        console.error("[ERROR] Chyba pri komunikácii s webom:", error.message);
        return { streams: [] };
    }
});

const port = process.env.PORT || 10000;
serveHTTP(builder.getInterface(), { port });
console.log(`🚀 Addon prepojený s vyhľadávaním beží na porte ${port}`);
