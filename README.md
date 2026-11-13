# mUIsik

**Lecteur de musique de bureau pour Windows** : votre musique devient votre fond d'écran.

- **Fond d'écran animé** derrière les icônes : le clip du morceau, la pochette animée, ou votre propre vidéo.
- **Lumière autour de l'écran** aux couleurs de la pochette, qui bouge au rythme du son. 4 styles (halo, pulsation, comètes, spectre), et 4 positions (tout, bas, haut, coins).
- **Paroles synchronisées** sur le bureau ([LRCLIB](https://lrclib.net), ou un fichier `.lrc` à côté d'un MP3), avec 4 animations. Police au choix parmi toutes celles installées, ainsi que la graisse, l'italique, la casse, l'espacement et l'alignement.
- **Lecteur « liquid glass »** : le verre floute et réfracte réellement ce qui est derrière lui. On y trouve la recherche, les playlists, la file d'attente, J'aime (Spotify), la répétition et le volume.
- Sources : **Spotify**, **YouTube**, **SoundCloud** et **fichiers locaux** (glissez un dossier sur le lecteur).

> Projet personnel, non affilié à Spotify, YouTube, SoundCloud ou Genius. La lecture passe toujours par leurs lecteurs et API officiels.

## Installer

Téléchargez l'installateur `mUIsik-Setup-<version>.exe` (onglet *Releases*), ou compilez-le vous-même (voir plus bas). L'installateur crée un raccourci sur le bureau et dans le menu Démarrer.

Windows peut afficher « Windows a protégé votre ordinateur » : l'exe n'est pas signé, car un certificat de signature est payant. Cliquez sur **Informations complémentaires › Exécuter quand même**.

Dans **Réglages › Système**, vous pouvez lancer mUIsik au démarrage de Windows. Il démarre alors discrètement, avec seulement son icône dans la zone de notification.

## Compiler

Prérequis : Windows 10/11 et [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
git clone https://github.com/aimerachid-traore/mUIsik.git
cd mUIsik
npm install
npm start          # lancer en développement
npm run dist       # → dist/mUIsik-Setup-<version>.exe
npm run pack       # → dist/win-unpacked/mUIsik.exe (sans installateur)
```

## Utilisation

- **Choisir la source** : bouton rond à gauche du lecteur.
- **Chercher, playlists, file d'attente, réglages** : icônes à droite du lecteur.
- **Déplacer le lecteur** : maintenez le clic sur une zone vide du verre (le titre, ou le haut du panneau), puis glissez.
- **Ajouter des morceaux à la file** : clic droit sur un résultat de recherche.
- **Ailleurs que sur le verre**, les clics vont au bureau et à vos icônes.
- **Icône de la zone de notification** : afficher ou masquer le lecteur, la lumière, le fond et les paroles, ou quitter.

## Brancher les services

Tout se règle dans **Réglages** (icône ⚙ du lecteur). Les clés restent sur votre PC (`%APPDATA%\mUIsik\settings.json`), et le jeton Spotify y est chiffré.

| Service | Ce qu'il faut | Sans clé |
|---|---|---|
| **Spotify** | Créer une appli sur <https://developer.spotify.com/dashboard>, cocher *Web API*, ajouter la Redirect URI `http://127.0.0.1:43821/callback`, coller le **Client ID**, puis cliquer sur « Connecter Spotify ». La musique joue dans l'appli Spotify (Premium requis pour la piloter). | — |
| **YouTube** | Une clé **YouTube Data API v3** (gratuite) sur <https://console.cloud.google.com>. Elle sert à la recherche, aux playlists, et à trouver le clip des titres Spotify ou SoundCloud pour le fond d'écran. | Coller un lien YouTube fonctionne. |
| **SoundCloud** | Un `client_id` de votre appli SoundCloud. | Coller un lien SoundCloud fonctionne. |
| **Paroles** | Rien : LRCLIB est gratuit. Si LRCLIB n'a que le texte sans horodatage, il est calé approximativement sur la durée. | Si rien n'est trouvé, le lecteur affiche des liens **Genius ↗** et **Google ↗**. |
| **Genius** (facultatif) | Un *Client Access Token* sur <https://genius.com/api-clients> : le lien Genius ouvre directement la bonne page. | Le lien ouvre une recherche Genius. |

## Performances

Mesurées sur la machine de développement (écran 144 Hz, clip YouTube 1080p en fond) :

| | Première version | Actuelle |
|---|---|---|
| Carte graphique (mUIsik + compositeur Windows) | ~88 % | ~20 % |
| Mémoire privée | 1 454 Mo | ~690 Mo |

La lumière est dessinée dans 4 bandes fines qui partagent un seul processus, en demi-résolution et à 30 images/s (option « Fluide » à 60). Elle s'arrête complètement quand la musique est en pause. Le fond d'écran met vraiment en veille ses calques cachés, et le lecteur n'est jamais redimensionné.

Options de diagnostic : `npx electron . --perf` (images/s et buffering du fond), `--occlude` (fenêtre plein écran 10 s par-dessus le fond), `--snap=<dossier>` (capture du lecteur posé sur le fond), `--hittest` (test de clic), `--play=<idVidéoYouTube>`, `--panel=settings`, `--dev`.

## Architecture

```
src/main/
  main.js        état unique + fenêtres + routage des commandes vers chaque source
  server.js      serveur local (pages sur localhost:43821, callback Spotify sur 127.0.0.1, proxy d'images, fichiers locaux)
  spotify.js     OAuth PKCE + Web API (Spotify Connect)
  sources.js     YouTube Data API, SoundCloud API, analyse des titres
  lyrics.js      LRCLIB + parseur LRC
  settings.js    réglages (%APPDATA%/mUIsik/settings.json, jeton Spotify chiffré)
  preload.js     pont sécurisé pages ↔ processus principal (liste blanche de canaux)
  native/desktop.ps1  place la fenêtre derrière les icônes (Progman/WorkerW, compatible 24H2)
src/renderer/
  wallpaper.*    visuels du fond + moteur audio (IFrame YouTube, widget SoundCloud, <audio>)
  glass.js       verre du lecteur (flou + réfraction SVG), dessiné dans le fond d'écran sous le lecteur
  edge.*         lumière (4 bandes, capture loopback du son de l'ordinateur)
  player.*       lecteur liquid glass
  lyrics.js      rendu des paroles
  shared.js      état partagé, couleurs de pochette, utilitaires
scripts/make-icon.js  génère l'icône de l'appli
```

## Limites connues

- Le verre réfractif montre le fond d'écran mUIsik. Posé sur une autre fenêtre, le lecteur reste lisible (verre teinté), mais il ne la réfracte pas.
- Certaines vidéos YouTube interdisent la lecture hors de YouTube (erreur 150). mUIsik l'indique et passe au titre suivant.
- La lumière réagit à **tout** le son de l'ordinateur (capture loopback).
- Pas encore d'Apple Music ni d'Amazon Music, d'effets sonores ou de stickers.

## Licence

MIT
