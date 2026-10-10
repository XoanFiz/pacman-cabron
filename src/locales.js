(() => {
    const supportedLanguages = new Set(["af","am","ar","as","az","be","bg","bn","bs","ca","ceb","cs","cy","da","de","el","en","eo","es","et","eu","fa","fi","fil","fo","fr","fy","gd","gl","gu","ha","he","hi","hr","ht","hu","hy","id","ig","is","it","ja","jv","ka","kk","km","kn","ko","ku","ky","la","lb","lo","lt","lv","mg","mi","mk","ml","mn","mr","ms","mt","my","nb","ne","nl","nn","no","ny","or","pa","pl","ps","pt","ro","ru","rw","si","sk","sl","so","sq","sr","su","sv","sw","ta","te","th","tr","uk","ur","uz","vi","xh","yi","yo","zh","zu"]);
    const preferences = navigator.languages && navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];
    const language = preferences
        .map(preference => preference.toLowerCase().split('-')[0])
        .find(preference => supportedLanguages.has(preference)) || 'en';

    window.PACMAN_LOCALE = language;

    const showLoadError = () => {
        const status = document.getElementById('status');

        if (status) {
            status.textContent = 'Unable to load game resources. Please reload the page.';
        }
    };
    const loadScript = (source, onload) => {
        const script = document.createElement('script');
        script.src = source;
        script.onload = onload;
        script.onerror = showLoadError;
        document.body.append(script);
    };

    loadScript('./src/locales/' + language + '.js', () => {
        loadScript('./src/game.js');
    });
})();
