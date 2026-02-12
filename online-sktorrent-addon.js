async function searchOnlineVideos(query) {
    // Odstránime rok z vyhľadávania, ak tam je (napr. "Zootopia 2 (2025)" -> "Zootopia 2")
    const cleanQuery = query.replace(/\s\(\d{4}\)/g, "").trim();
    const searchUrl = `https://online.sktorrent.eu/search/videos?search_query=${encodeURIComponent(cleanQuery)}`;
    
    console.log(`[SEARCHING] Skúšam: ${cleanQuery}`);
    try {
        const res = await axios.get(searchUrl, { 
            headers: commonHeaders, 
            timeout: 8000,
            validateStatus: false 
        });
        const $ = cheerio.load(res.data);
        const ids = [];
        
        // SKTorrent niekedy dáva výsledky do triedy .video-item alebo jednoducho do <a> tagov v hlavnom obsahu
        $("a").each((i, el) => {
            const href = $(el).attr("href") || "";
            const match = href.match(/\/video\/(\d+)/);
            if (match) {
                // Overíme, či názov v odkaze aspoň trochu sedí (nepovinné, ale pomáha)
                ids.push(match[1]);
            }
        });
        return [...new Set(ids)]; 
    } catch (err) {
        console.error(`[SEARCH ERROR] ${err.message}`);
        return [];
    }
}

builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId, season, episode] = id.split(":");
    const info = await getTitleFromIMDb(imdbId);
    if (!info) return { streams: [] };

    const queries = new Set();
    
    // 1. Skúsime originálny názov
    queries.add(removeDiacritics(info.originalTitle));
    
    // 2. Skúsime lokálny názov (ak je iný)
    queries.add(removeDiacritics(info.title));

    // 3. Špeciálny fix pre animáky (Zootopia vs Zootropolis)
    if (info.originalTitle.toLowerCase().includes("zootopia")) {
        queries.add(info.originalTitle.toLowerCase().replace("zootopia", "zootropolis"));
    }

    let allStreams = [];
    for (const q of queries) {
        const vIds = await searchOnlineVideos(q);
        if (vIds.length > 0) {
            for (const vid of vIds) {
                const results = await extractStreams(vid);
                allStreams.push(...results);
            }
        }
        // Ak sme našli aspoň jeden funkčný stream, končíme hľadanie ďalších variácií
        if (allStreams.length > 0) break;
    }

    // Posledná záchrana: ak je to film s číslom a nič sme nenašli, skúsime len názov bez čísla
    if (allStreams.length === 0 && info.originalTitle.match(/\d$/)) {
        const fallbackQuery = info.originalTitle.replace(/\s\d$/, "");
        console.log(`[FALLBACK] Nič nenájdené, skúšam bez čísla: ${fallbackQuery}`);
        const vIds = await searchOnlineVideos(fallbackQuery);
        for (const vid of vIds) {
            const results = await extractStreams(vid);
            allStreams.push(...results);
        }
    }

    console.log(`[RESULT] Celkovo nájdených ${allStreams.length} streamov.`);
    return { streams: allStreams };
});
