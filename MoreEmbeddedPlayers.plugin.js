/**
 * @name MoreEmbeddedPlayers
 * @authorLink https://github.com/Valafi
 * @donate https://paypal.me/Valafi
 * @website https://github.com/Valafi/MoreEmbeddedPlayers
 * @source https://raw.githubusercontent.com/Valafi/MoreEmbeddedPlayers/main/MoreEmbeddedPlayers.plugin.js
 * @version 0.0.6
 * @updateUrl https://raw.githubusercontent.com/Valafi/MoreEmbeddedPlayers/main/MoreEmbeddedPlayers.plugin.js
 */

/* DEVELOPER NOTE: Hey, if you know a better way to do anything that's done in here, I'd love to hear from you!
                   Currently, I don't know enough about the internals of Discord to patch the embed/attachment processing,
                   so this script just edits the embed/attachment elements after Discord is done making them. */

class MoreEmbeddedPlayers {
    getName() {return "MoreEmbeddedPlayers";}
    getDescription() {return "Adds embedded players for: Bandcamp, Google Drive, Mega, and module audio files (over 50 types). More to come! Note: Certain features require the usage of a CORS bypass proxy to download data like album IDs, you can override the proxy used in the plugin settings.";}
    getVersion() {return "0.0.6";}
    getAuthor() {return "Valafi#7698";}

    start() {
        if (!global.ZeresPluginLibrary) return window.BdApi.alert("Library Missing",`The library plugin needed for ${this.getName()} is missing.<br /><br /> <a href="https://betterdiscord.net/ghdl?url=https://raw.githubusercontent.com/rauenzi/BDPluginLibrary/master/release/0PluginLibrary.plugin.js" target="_blank">Click here to download the library!</a>`);
        ZLibrary.PluginUpdater.checkForUpdate(this.getName(), this.getVersion(), "https://raw.githubusercontent.com/Valafi/MoreEmbeddedPlayers/main/MoreEmbeddedPlayers.plugin.js");

        this.loadSettings();

        this._handleMutation = this.handleMutation.bind(this); // Preserve 'this' (makes 'this' bound to class instead of MutationObserver)
        this.observer = new MutationObserver(this._handleMutation);
        this.observer.observe(document, {subtree:true, childList: true, attributes: false, characterData: false});
    }

    stop() {
        this.saveSettings();

        this.observer.disconnect();
	}

    getSettingsPanel() {
        const list = [];
        list.push(new ZLibrary.Settings.Switch("Enable Bandcamp Embedding", "Website embeds for Bandcamp links will be replaced with the Bandcamp player.", this.settings.bandcamp, (value) => { this.settings.bandcamp = value; }, {disabled: false}));
        list.push(new ZLibrary.Settings.Switch("Enable Google Drive Embedding", "Website embeds for Google Drive file links will be replaced with the Google Drive Previewer.\nSupport coming soon for these types: My Maps, Apps Script, Jamboard.", this.settings.google_drive, (value) => { this.settings.google_drive = value; }, {disabled: false}));
        list.push(new ZLibrary.Settings.Switch("Enable Mega Embedding", "Website embeds for Mega links will be replaced with the Mega player.", this.settings.mega, (value) => { this.settings.mega = value; }, {disabled: false}));
        list.push(new ZLibrary.Settings.Switch("Enable Module Audio Player", "File attachments for module audio files will be playable with a version of the Cowbell player.", this.settings.module_audio, (value) => { this.settings.module_audio = value; }, {disabled: false}));
        list.push(new ZLibrary.Settings.Switch("Override CORS Proxy", "This plugin has two parts which (currently) require a CORS proxy: getting the Bandcamp album/track ID, and downloading module audio file attachments to be played. The default CORS proxy used is from https://allorigins.win, but you can override that by turning this setting on and changing the text below.", this.settings.override_cors_proxy, (value) => { this.settings.override_cors_proxy = value; }, {disabled: false}));
        list.push(new ZLibrary.Settings.Textbox(null, null, this.settings.custom_cors_proxy, (value) => { this.settings.custom_cors_proxy = value; }, {placeholder: "https://api.allorigins.win/raw?url="}));

        const panel = new ZLibrary.Settings.SettingPanel(this.saveSettings.bind(this), ...list);
        return panel.getElement();
    }

    saveSettings() {
        ZLibrary.PluginUtilities.saveSettings('MoreEmbeddedPlayers', this.settings);
    }

    loadSettings() {
        this.settings = ZLibrary.Utilities.deepclone(ZLibrary.PluginUtilities.loadSettings('MoreEmbeddedPlayers', {
            // Default settings
            bandcamp: true,
            google_drive: true,
            mega: true,
            module_audio: true,
            override_cors_proxy: false,
            custom_cors_proxy: "https://api.allorigins.win/raw?url=",
            cache: {}
        }));
    }

    handleMutation(mutations) { // TODO: Jumping to a message means it doesn't embed. // TODO: Embedding for messages in a search is buggy, starts off not working, then every letter typed reloads it?
        if (mutations.length <= 0) { return; }
        for (let m of mutations) {
            if (m.addedNodes.length <= 0) { continue; }
            for (let node of m.addedNodes) {
                if (node.classList == null || node.classList <= 0) { continue; } // Text element doesn't have classList
                for (let classname of node.classList) {
                    let searchElement;

                    switch (classname) {
                        case "messageListItem-ZZ7v6g": // Message detected
                            searchElement = node.ownerDocument.getElementById(node.id.replace("chat-messages-", "message-accessories-"));
                            break;
                        case "chatContent-3KubbW": // Channel detected
                            searchElement = node.ownerDocument;
                            break;
                        case "embed-hKpSrO": // Message edit detected
                        case "attachment-1PZZB2": // TODO: Is this case necessary?
                            searchElement = node.parentElement;
                    }

                    if (searchElement) {
                        for (let embed of searchElement.getElementsByClassName("embed-hKpSrO")) {
                            this.handleEmbed(embed);
                        }

                        for (let attachment of searchElement.getElementsByClassName("attachment-1PZZB2")) {
                            this.handleAttachment(attachment);
                        }

                        break;
                    }
                }
            }
        }
    }

    handleEmbed(e) {
        // TODO: Improve cache storage to reduce redundancy
        // TODO: Come up with better way to prevent re-embedding. Currently it won't find an embedLink-1TLNja

        // Get embed links
        const links = e.getElementsByClassName("embedLink-1TLNja");
        if (links.length == 0) { return; }
        
        // Get embed url
        const url = new URL(links[0]); // TODO: Remove assumption here

        // TODO: Does Google Photos have an embeddable viewer? Currently Discord just loads single images fine, but for albums it just loads the first image
        switch(url.hostname) {
            case "docs.google.com": // Docs, Spreadsheets, Slides, Forms, Drawings
            case "drive.google.com": // Everything. What users will likely put in: Videos, Audio, Images, PDF, archives, Excel sheets
                if (this.settings.google_drive == false) { return; }

                e.setAttribute("style", "border-color: hsl(214, calc(var(--saturation-factor, 1) * 100%), 51%);");
                if (url.hostname == "docs.google.com") {
                    this.embedGoogleDocs(url, e.firstChild);
                } else {
                    this.embedGoogleDrive(url, e.firstChild);
                }

                break;
            case "mega.nz":
                if (this.settings.mega == false) { return; }

                // Get message content
                const messages = e.parentElement.parentElement.getElementsByClassName("messageContent-2t3eCI");
                if (messages.length == 0) { return; }

                // Get links from message
                const anchors = messages[0].getElementsByTagName("a");  // TODO: Remove assumption here

                // Find full URL since embed URL is missing the decription key
                let fullURL;
                for (let a of anchors) {
                    if (a.href.startsWith(url) == true) {
                        fullURL = new URL(a.href);
                        break;
                    }
                }
                if (fullURL == null) { return; }

                e.setAttribute("style", "border-color: hsl(357, calc(var(--saturation-factor, 1) * 100%), 63%);");
                this.embedMega(fullURL, e.firstChild);

                break;
            case "soundcloud.com":
                // Override the Soundcloud embed border color to something not awful
                e.setAttribute("style", "border-color: hsl(20, calc(var(--saturation-factor, 1) * 100%), 50%);");

                break;
            default:
                if (url.hostname.split(".")[1].toLowerCase() == "bandcamp") {
                    if (this.settings.bandcamp == false) { return; }
                    
                    e.setAttribute("style", "border-color: hsl(193, calc(var(--saturation-factor, 1) * 100%), 44%);");
                    this.embedBandcamp(url, e.firstChild);
                }
        }
    }

    handleAttachment(a) {
        // Get attachment links
        const links = a.getElementsByClassName("fileNameLink-1odyIc");
        if (links.length == 0) { return; }

        // Get attachment url
        const url = new URL(links[0]); // TODO: Remove assumption here

        // Get attachment file extension
        let ext;
        let ext2;
        {
            const parts = url.pathname.split(".");
            ext = parts[parts.length - 1];
            ext2 = "";

            switch (ext.toLowerCase()) {
                // Compressed files (LHA and more?)
                case "zip":
                case "rar":
                case "gz":
                case "7z":
                case "bz2":
                case "tar":
                case "wim":
                case "xz":
                    ext2 = ext;
                    ext = parts[parts.length - 2];
            }
        }

        switch (ext.toLowerCase()) {
            // MODULE AUDIO FILES https://wiki.openmpt.org/Manual:_Module_formats, not supported: ahx, hvl
            // Module audio files
            case "mod":
            case "s3m":
            case "xm":
            case "it":
            case "mptm":
            case "669":
            case "amf":
            case "ams":
            case "c67":
            case "dbm":
            case "digi":
            case "dmf":
            case "dsm":
            case "dtm":
            case "far":
            case "gdm":
            case "imf":
            case "j2b":
            case "mdl":
            case "med":
            case "mt2":
            case "mtm":
            case "okt":
            case "plm":
            case "psm":
            case "ptm":
            case "sfx":
            case "stm":
            case "ult":
            case "umx":
            // Module audio files (compressed)
            case "mo3":
            // Module audio files (unlisted support)
            case "oct":
            // Module audio files (unconfirmed support)
            case "mid": // TODO: Should probably disable this one...
            case "dsym":
            case "fmt":
            case "ice":
            case "st26":
            case "itp": // TODO: Might want to disable this one...
            case "m15":
            case "stk":
            case "mus":
            case "oxm":
            case "pt36":
            case "sfx2":
            case "mms":
            case "stx":
            case "stp": // TODO: Untested because Discord displayed it as code...
            case "symmod":
            case "wow":
            // Module audio files (compressed, unconfirmed support)
            case "mdz":
            case "s3z":
            case "xmz":
            case "itz":
            case "mptmz":
            case "mdr":
            // Module audio files (???, unconfirmed support)
            case "mmcmp":
            case "xpk":
            case "pp20":
                // Experimental archive support
                switch (ext2.toLowerCase()) {
                    case "zip": // TODO: Only supports the Deflate method, probably why gz works too
                    //case "rar": // TODO: This was supposed to work
                    case "gz":
                        break;
                    default: // Not supported: 7z, bz2, tar, wim, xz
                        if (ext2 != "") { return; }
                }

                if (this.settings.module_audio == false) { return; }
                this.attachCowbell(url, a);
        }
    }

    async download(url) {
        const response = await fetch(url);

        if (!response.ok) {
            const message = `An error has occured: ${response.status}`;
            throw new Error(message);
        }

        const text = await response.text();
        return text;
    }

    async proxyDownload(url) {
        const proxy = `${this.settings.override_cors_proxy ? this.settings.custom_cors_proxy : "https://api.allorigins.win/raw?url="}`;
        const text = await this.download(`${proxy}${encodeURIComponent(url)}`);
        return text;
    }

    async embedBandcamp(url, embedElement) {
        // Get the item type and id from the cache or the Internet
        let item_type, item_id;
        if (this.settings.cache[url]) {
            // Get type and id from local cache
            item_type = this.settings.cache[url].item_type;
            item_id = this.settings.cache[url].item_id;
        } else {
            // Download the track/album page for parsing
            const responseText = await this.proxyDownload(url);

            // Parse item type
            item_type = responseText.match(/item_type=((track)|(album))/g);
            if (item_type == null) { BdApi.showToast("ERROR!"); return; } // TODO: Make proper error handling
            item_type = item_type[0].split("=")[1];

            // Parse item id
            item_id = responseText.match(/item_id=[0-9]+/g);
            if (item_id == null) { BdApi.showToast("ERROR!"); return; } // TODO: Make proper error handling
            item_id = item_id[0].split("=")[1];

            // Save item type and id to cache
            this.settings.cache[url] = {};
            this.settings.cache[url].item_type = item_type;
            this.settings.cache[url].item_id = item_id;
            this.saveSettings();
        }

        const rawTitle = "Bandcamp link"; // TODO: Implement rawTitle

        // Create embedded player
        const iframe = document.createElement("iframe");
        iframe.setAttribute("style", `border: 0; width: 350px; height: ${(item_type == "album") ? "786" : "442"}px;`);
        iframe.setAttribute("src", `https://bandcamp.com/EmbeddedPlayer/${item_type}=${item_id}/size=large/bgcol=ffffff/linkcol=0687f5/tracklist=${(item_type == "album")}/transparent=true/`);
        iframe.setAttribute("seamless", "");

        // Create Bandcamp's rawTitle fallback
        const a = document.createElement("a");
        a.setAttribute("href", `${url}`);
        a.textContent = rawTitle;
        iframe.appendChild(a);

        // Replace embed with embedded player
        while (embedElement.firstChild) { // TODO: Should probably validate embedElement still exists and hasn't changed
            embedElement.removeChild(embedElement.firstChild);
        }
        embedElement.appendChild(iframe);
    }

    embedGoogleDocs(url, embedElement) { // TODO: Custom embed becomes blank if I remove public access // TODO: Should combind embedGoogleDocs() and embedGoogleDrive
        const id = url.pathname.split("/")[3];

        embedElement.innerHTML = `
<iframe src="https://drive.google.com/file/d/${id}/preview" width="480" height="360" allowfullscreen="allowfullscreen"></iframe>
        `; // Original embed options: width="640" height="480" allow="autoplay"
    }

    embedGoogleDrive(url, embedElement) { // TODO: This is being used for images too, but allowfullscreen only works for videos // TODO: Audio and Images have blank space due to player size, but audio could have img
        url.search = "" // Removes "?usp=sharing"
        url.pathname = (() => {
            const parts = url.pathname.split("/").slice(0, 4); // Removes "/view" or "/edit"
            parts.push("preview"); // Adds "/preview"

            return parts.join("/");
        })();

        embedElement.innerHTML = `
<iframe src="${url}" width="480" height="360" allowfullscreen="allowfullscreen"></iframe>
        `; // Original embed options: width="640" height="480" allow="autoplay"
    }

    embedMega(url, embedElement) { // TODO: Don't embed when decryption key is missing from URL // TODO: Add optional step where the filename extension is checked before embedding, can cache too
        // Share link: https://mega.nz/file/FphUiDwZ#4pMv-rWQ5Mx_hkcq2JsWZOnR3EZQ8TMP8CGo2h8D_HY
        // Embed link: https://mega.nz/embed/FphUiDwZ#4pMv-rWQ5Mx_hkcq2JsWZOnR3EZQ8TMP8CGo2h8D_HY
        // Embed form: <iframe width="640" height="360" frameborder="0" src="https://mega.nz/embed/FphUiDwZ#4pMv-rWQ5Mx_hkcq2JsWZOnR3EZQ8TMP8CGo2h8D_HY" allowfullscreen ></iframe>

        url.pathname = (() => {
            const parts = url.pathname.split("/");
            parts[1] = "embed"; // Change "file" to "embed"

            return parts.join("/");
        })();

        embedElement.innerHTML = `
<iframe width="360" height="270" frameborder="0" src="${url}" allowfullscreen ></iframe>
        `; // Original embed options: width="640" height="360"
    }

    attachCowbell(url, attachmentElement) {
        const iframe = document.createElement('iframe');
        const html = `
<!DOCTYPE HTML>
<html>
    <head>
        <meta charset="utf-8">
        <meta http-equiv="X-UA-Compatible" content="chrome=1">
        <title>Cowbell - a universal web audio player for demoscene music</title>


        <meta name="viewport" content="width=device-width">

        <script src="https://demozoo.github.io/cowbell/cowbell/cowbell.min.js"></script>
        <!--<script src="https://demozoo.github.io/cowbell/cowbell/ay_chip.min.js"></script>-->
        <!--<script src="https://demozoo.github.io/cowbell/cowbell/vtx.min.js"></script>-->
        <!--<script src="https://demozoo.github.io/cowbell/cowbell/zx.min.js"></script>-->
        <script src="https://demozoo.github.io/cowbell/cowbell/openmpt.min.js"></script>
        <!--<script src="https://demozoo.github.io/cowbell/cowbell/jssid.min.js"></script>-->
        <!--<script src="https://demozoo.github.io/cowbell/cowbell/asap.min.js"></script>-->

        <script>
            function go() {
                //const audioPlayer = new Cowbell.Player.Audio();
                //const psgZXPlayer = new Cowbell.Player.PSG();
                //const psgSTPlayer = new Cowbell.Player.PSG({ayFrequency: 2000000, ayMode:"YM"});
                //const stcPlayer = new Cowbell.Player.ZXSTC({stereoMode: 'acb'});
                //const pt3Player = new Cowbell.Player.ZXPT3({stereoMode: 'acb'});
                //const sqtPlayer = new Cowbell.Player.ZXSQT({stereoMode: 'acb'});
                //const vtxPlayer = new Cowbell.Player.VTX();
                const modPlayer = new Cowbell.Player.OpenMPT({
                    'pathToLibOpenMPT': 'https://demozoo.github.io/cowbell/cowbell/libopenmpt.js'
                });
                //const sidPlayer = new Cowbell.Player.JSSID();
                //const asapPlayer = new Cowbell.Player.ASAP();

                const track = new modPlayer.Track('${this.settings.override_cors_proxy ? this.settings.custom_cors_proxy : "https://api.allorigins.win/raw?url="}${encodeURIComponent(url)}');

                const container = document.getElementById('player');
                const playerUI = new Cowbell.UI.Basic(container);

                playerUI.open(track);

                container.lastChild.style = "width: 80%;";
            }
        </script>
    </head>

    <body onload="go()" style="margin: 0; background-color: black;">
        <div id="player" style="margin-top: 6px; margin-left: 6px; display: flex; align-items: center;"></div>
    </body>
</html>
        `;
        iframe.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
        const previous = document.createElement("div");
        previous.style = "display: flex; align-items: center; margin-bottom: 10px;";
        previous.append(...attachmentElement.childNodes);
        previous.firstChild.src = "/assets/e83eaad3ae5c32a355b55f157e6cd3da.svg";
        previous.firstChild.style = "width: 24px; height: 40px;";
        attachmentElement.style = "display: block; padding-top: 6px; max-width: 100%;";
        attachmentElement.parentElement.style = "width: 400px;";
        iframe.style = "width: 100%; height: 32px;";
        attachmentElement.appendChild(previous);
        attachmentElement.appendChild(iframe);
    }
}
