// ... (začiatok kódu ostáva rovnaký ako v1.1.0 vrátane CookieJar)

async function extractAllFormats(videoId, pageTitle) {
    const videoUrl = `https://online.sktorrent.eu/video/${videoId}`;
    try {
        const res = await client.get(videoUrl, { headers: commonHeaders });
        const $ = cheerio.load(res.data);
        const streams = [];

        // 1. Hľadáme všetky <source> tagy v prehrávači (rôzne kvality)
        $('video source').each((i, el) => {
            const src = $(el).attr('src');
            const label = $(el).attr('label') || $(el).attr('res') || 'Video';
            
            if (src) {
                streams.push({
                    name: `SKTonline 🟦 ${label}`,
                    title: `${pageTitle}\nFormát: MP4/Stream`,
                    url: src.startsWith('http') ? src : `https://online.sktorrent.eu${src}`
                });
            }
        });

        // 2. Hľadáme priame odkazy na stiahnutie (často iná kvalita alebo backup)
        $('a[href*="get_video"]').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim().replace('Stiahnuť video', '').trim();
            
            if (href) {
                streams.push({
                    name: `SKTonline 📥 ${text || 'Priamy link'}`,
                    title: `${pageTitle}\nFormát: MP4 (Download server)`,
                    url: href.startsWith('http') ? href : `https://online.sktorrent.eu${href}`
                });
            }
        });

        // 3. Detekcia HLS (m3u8) - ak by web začal používať adaptívne streamy
        const scripts = $('script').html();
        const hlsMatch = scripts ? scripts.match(/file:\s*"(.*\.m3u8)"/) : null;
        if (hlsMatch) {
            streams.push({
                name: "SKTonline 🌐 HLS",
                title: `${pageTitle}\nAdaptívna kvalita`,
                url: hlsMatch[1]
            });
        }

        return streams;
    } catch (err) {
        console.log(`[EXTRACT ERROR] ID: ${videoId} - ${err.message}`);
        return [];
    }
}

builder.defineStreamHandler(async ({ id }) => {
    const imdbId = id.split(":")[0];
    const movieName = await getIMDbName(imdbId);
    if (!movieName) return { streams: [] };

    // ... (logika vyhľadávania z predchádzajúcej verzie)
    
    let allStreams = [];
    for (const vid of videos.slice(0, 3)) { // Prejdeme top 3 výsledky z webu
        const found = await extractAllFormats(vid.id, vid.title);
        allStreams.push(...found);
    }

    // Odstránenie duplicitných URL adries
    const uniqueStreams = allStreams.filter((v, i, a) => a.findIndex(t => (t.url === v.url)) === i);

    console.log(`[DONE] Nájdených ${uniqueStreams.length} unikátnych streamov.`);
    return { streams: uniqueStreams };
});

// ... (zvyšok kódu)
